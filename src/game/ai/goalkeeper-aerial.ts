import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, TeamMatchState } from '../match/state'
import type { PlayerDefinition } from '../model/player'
import { advanceBallPhysics, BALL_RADIUS_M } from '../physics/ball'
import { deriveMotionLimits } from '../physics/locomotion'
import { activePhysicalShot } from './goal-directed'
import { separationM, boundedTarget } from './coordination'

/**
 * Phase 6.9T: a goalkeeper considers only real, lofted opposition kicks from
 * a wide advanced source into their own penalty area. Low passes, shots,
 * diagnostic launches and old/retouched balls are NOT called crosses.
 *
 * All arrival and movement estimates are tactical predictions, never a
 * generated catch, punch or teleport. The authoritative 50ms swept contact
 * resolver separately decides whether the goalkeeper touches the ball.
 */
export const GOALKEEPER_AERIAL_VERSION = 'real-lofted-cross-claim-punch-p69t-v1'
const clamp = (value: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, value))
const MAX_CROSS_AGE_TICKS = 58
const MAX_LOOKAHEAD_TICKS = 42

export interface LiveAerialDelivery {
  readonly kickerId: string
  readonly kickTick: number
  readonly lift: number
}

/** Identify the latest uninterrupted, physically executed wide delivery. */
export function activeAerialDelivery(
  state: MatchState, setup: MatchSetup, team: TeamMatchState,
): LiveAerialDelivery | null {
  if (state.ball.controllerId !== null || state.ball.outsidePitch ||
      activePhysicalShot(state)) return null
  let kick: (typeof state.contactEvents)[number] | undefined
  // Reverse scan only to the latest genuine successful kick; old failed
  // attempts cannot create a cross or steal the original ball's provenance.
  for (let i = state.contactEvents.length - 1; i >= 0; i--) {
    const event = state.contactEvents[i]
    if (event.outcome === 'kicked') {
      kick = event
      break
    }
  }
  if (!kick || kick.playerId !== state.ball.lastTouchPlayerId ||
      state.clock.tick < kick.tick ||
      state.clock.tick - kick.tick > MAX_CROSS_AGE_TICKS ||
      kick.commandId.startsWith('ai-shot-')) return null

  const kicker = state.players.find(p => p.playerId === kick.playerId)
  if (!kicker || kicker.clubId === team.clubId) return null

  let command: (typeof state.appliedCommands)[number] | undefined
  for (let i = state.appliedCommands.length - 1; i >= 0; i--) {
    if (state.appliedCommands[i].commandId === kick.commandId) {
      command = state.appliedCommands[i]
      break
    }
  }
  if (!command || command.type !== 'attemptKick' || command.lift < .28)
    return null
  const { widthM, lengthM, penaltyAreaDepthM } = setup.pitch
  const goalX = team.attackingDirection === 1 ? 0 : lengthM
  const depth = (kicker.position.xM - goalX) * team.attackingDirection
  const targetDepth = (command.target.xM - goalX) * team.attackingDirection
  const centre = widthM / 2
  // Kicker positions may have moved a little after contact, so use a
  // generous advanced/wide source filter; actual flight determines whether
  // this delivery is relevant once it reaches the penalty area.
  if (depth < 0 || depth > 39 ||
      Math.abs(kicker.position.yM - centre) < 11 ||
      Math.abs(command.target.yM - centre) > 13 ||
      Math.abs(command.target.yM - kicker.position.yM) < 8 ||
      targetDepth < 0 || targetDepth > penaltyAreaDepthM + 3) return null

  // A lofted ball that already landed must not remain an aerial contest.
  if (state.ball.heightM <= BALL_RADIUS_M + .03 &&
      state.ball.velocity.zMps <= 0) return null
  return {
    kickerId: kick.playerId,
    kickTick: kick.tick,
    lift: command.lift,
  }
}

export interface GoalkeeperAerialIntent {
  readonly mode: 'hold' | 'claim'
  readonly target: Point2
  readonly engage: boolean
  readonly impactSeconds: number | null
}

/** A physically bounded overhead hand envelope—not an infinite aerial
 * magnet. The existing swept-ball collision still decides contact.
 */
export function goalkeeperCrossHandReach(definition: PlayerDefinition) {
  const gk = definition.abilities.goalkeeping
  if (!gk) throw new Error('Cross hand reach requires a goalkeeper')
  return {
    horizontalM: .98 + .0053 * gk.crossClaiming +
      .0015 * definition.abilities.physical.verticalLeap,
    maximumHeightM: 1.91 + .0027 * gk.crossClaiming +
      .0022 * definition.abilities.physical.verticalLeap,
  }
}

/** A forward-predictive, small (~2s) flight scan. Uses the SAME ball physics
 * as match play and only searches locations on the goalkeeper's own side.
 * No RNG, duplicate ball engine, success award or per-frame rendering work.
 */
export function planGoalkeeperAerial(
  state: MatchState, setup: MatchSetup,
  keeper: PlayerMatchState, team: TeamMatchState,
): GoalkeeperAerialIntent | null {
  if (keeper.formationSlot !== 'GK' ||
      keeper.clubId !== team.clubId ||
      state.ball.controllerId === keeper.playerId) return null
  if (!activeAerialDelivery(state, setup, team)) return null
  const definition = setup.players.find(p => p.id === keeper.playerId)
  const gk = definition?.abilities.goalkeeping
  if (!definition || !gk) return null

  const { pitch } = setup
  const goalX = team.attackingDirection === 1 ? 0 : pitch.lengthM
  const centreY = pitch.widthM / 2
  const reaches = goalkeeperCrossHandReach(definition)
  const limits = deriveMotionLimits(definition, keeper.energy)
  const quality = (
    .38 * gk.crossClaiming + .28 * gk.commandOfArea +
    .18 * gk.positioning + .16 * definition.abilities.mental.decisions
  ) / 100

  let ball = state.ball
  let best: { target: Point2; seconds: number; effort: number } | null = null
  for (let step = 1; step <= MAX_LOOKAHEAD_TICKS; step++) {
    const previous = ball
    ball = advanceBallPhysics(ball, pitch)
    const seconds = step * .05
    if (ball.outsidePitch) break
    if (ball.heightM < .68 && ball.velocity.zMps <= 0) break
    const xDepth = (ball.position.xM - goalX) * team.attackingDirection
    if (xDepth < 1.2 || xDepth > pitch.penaltyAreaDepthM - .8 ||
        Math.abs(ball.position.yM - centreY) > 11 ||
        ball.heightM < .75 || ball.heightM > reaches.maximumHeightM)
      continue
    // Project the existing player acceleration envelope conservatively;
    // actual turning and braking are still applied by authoritative motion.
    const timeToTop = limits.maxSpeedMps / limits.accelerationMps2
    const accelerating = Math.min(seconds, timeToTop)
    const travel = .5 * limits.accelerationMps2 *
      accelerating * accelerating +
      limits.maxSpeedMps * Math.max(0, seconds - timeToTop)
    const gap = separationM(keeper.position, ball.position)
    const allowance = Math.max(0, travel * .72) +
      reaches.horizontalM * .7
    if (gap > allowance) continue

    const nearbyOpponent = state.players.some(p =>
      p.clubId !== team.clubId && p.formationSlot !== 'GK' &&
      separationM(p.position, ball.position) < 2.4)
    // A hesitant keeper leaves tight aerial contests to defenders.
    // Good command of area and claiming ratings make going out credible.
    if (nearbyOpponent && quality < .64 && gap > 1.35) continue
    const effort = gap / Math.max(1, allowance) +
      (nearbyOpponent ? .20 : 0) +
      (ball.heightM > 2.15 ? .12 : 0)
    if (!best || effort + seconds * .1 <
        best.effort + best.seconds * .1) {
      best = { target: ball.position, seconds, effort }
    }
    // Stop at the first safe falling/descending window if a feasible
    // position has been found; never chase later ground bounces.
    if (best && previous.velocity.zMps > 0 &&
        ball.velocity.zMps <= 0) break
  }

  if (!best) return null
  // Low-quality keepers hold the line on an uncertain deep claim, unless
  // the ball is already clearly reachable at their current position.
  const separation = separationM(keeper.position, best.target)
  if (quality < .48 && separation > 1.9) return {
    mode: 'hold', target: { ...keeper.position },
    engage: false, impactSeconds: best.seconds,
  }
  return {
    mode: 'claim',
    target: boundedTarget(best.target, pitch),
    engage: true,
    impactSeconds: best.seconds,
  }
}

/** Update only the goalkeeper's real intention every 50ms while an actual
 * delivery is flying. Outfield agents and the ball state remain untouched.
 */
export function trackGoalkeeperAerials(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (state.kickoff?.phase === 'awaitingKick' ||
      state.ball.controllerId !== null || activePhysicalShot(state)) return state
  const updates = new Map<string, GoalkeeperAerialIntent>()
  for (const [index, team] of state.teams.entries()) {
    if (!state.ai.enabledTeams[index]) continue
    const keeper = state.players.find(p =>
      p.clubId === team.clubId && p.formationSlot === 'GK')
    if (!keeper) continue
    const intent = planGoalkeeperAerial(state, setup, keeper, team)
    if (intent) updates.set(keeper.playerId, intent)
  }
  if (!updates.size) return state
  return {
    ...state,
    players: state.players.map(p => {
      const intent = updates.get(p.playerId)
      if (!intent) return p
      const old = p.intention
      const same = old.kind === 'moveToPoint' &&
        separationM(old.target, intent.target) < .2
      return {
        ...p, engagesBall: intent.engage,
        intention: same ? old : {
          kind: 'moveToPoint' as const,
          sinceTick: state.clock.tick, target: intent.target,
        },
      }
    }),
    ai: {
      ...state.ai,
      decisionSnapshot: state.ai.decisionSnapshot.map(d => {
        const intent = updates.get(d.playerId)
        return intent ? {
          ...d, action: 'claimCross' as const,
          engage: intent.engage, target: intent.target,
        } : d
      }),
    },
  }
}
