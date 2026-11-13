import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, separationM } from './coordination'
import { planGoalkeeperPosition } from './goalkeeper-positioning'

/**
 * Phase 6.9S — one-on-one judgement while a striker STILL controls the ball.
 * It never issues a save, teleports a keeper, or awards possession. Shot
 * responses and ball-contact physics remain separate, authoritative systems.
 *
 * These are estimated tactical distance calibrations, not real tracking data.
 */
export const GOALKEEPER_ONE_ON_ONE_VERSION = 'breakaway-angle-smother-p69s-v1'
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export interface GoalkeeperOneOnOneIntent {
  readonly mode: 'hold' | 'close' | 'smother'
  readonly target: Point2
  readonly engage: boolean
}

function coveredByDefender(
  state: MatchState, keeper: PlayerMatchState,
  carrier: PlayerMatchState, team: TeamMatchState,
): boolean {
  // Do not rush through our own covering centre-back just because the
  // attacking player is inside the penalty area.
  for (const player of state.players) {
    if (player.clubId !== team.clubId ||
        player.playerId === keeper.playerId ||
        player.participation !== 'onField') continue
    if (separationM(player.position, carrier.position) > 4.4) continue
    if ((player.position.xM - carrier.position.xM) *
        team.attackingDirection <= 1.3) return true
  }
  return false
}

/** Determine whether there is an isolated goalward carrier and what a
 * keeper should do BEFORE a shot. Takes the same decision on either side.
 */
export function planGoalkeeperOneOnOne(
  state: MatchState, setup: MatchSetup,
  keeper: PlayerMatchState, team: TeamMatchState,
): GoalkeeperOneOnOneIntent | null {
  if (keeper.formationSlot !== 'GK' ||
      keeper.clubId !== team.clubId || keeper.participation !== 'onField' ||
      state.ball.outsidePitch || state.ball.heightM > .5) return null

  const carrier = state.players.find(p =>
    p.playerId === state.ball.controllerId)
  if (!carrier || carrier.clubId === team.clubId ||
      carrier.formationSlot === 'GK') return null
  const definition = setup.players.find(p => p.id === keeper.playerId)
  const gk = definition?.abilities.goalkeeping
  if (!gk || !definition) return null

  const { pitch } = setup
  const goalX = team.attackingDirection === 1 ? 0 : pitch.lengthM
  const centreY = pitch.widthM / 2
  const depth = (carrier.position.xM - goalX) * team.attackingDirection
  const offsetY = Math.abs(carrier.position.yM - centreY)
  if (depth < 1 || depth > 21 ||
      offsetY > Math.min(14, 5.5 + depth * .65) ||
      coveredByDefender(state, keeper, carrier, team)) return null

  const distance = separationM(keeper.position, carrier.position)
  const goalwardSpeed =
    -carrier.velocity.xMps * team.attackingDirection
  const advancingThreat = goalwardSpeed > .9
  // Don't convert a harmless stationary ball near the penalty arc into a
  // 20-metre goalkeeper charge. Close only if the breakaway is genuine.
  if (depth > 14 && !advancingThreat && distance > 8.5) return null

  const quality = clamp((
    gk.oneOnOnes * .40 + gk.rushingOut * .25 +
    gk.positioning * .20 + definition.abilities.mental.decisions * .15
  ) / 100, 0, 1)
  const predictedY = clamp(
    carrier.position.yM + carrier.velocity.yMps * (.12 + quality * .12),
    0, pitch.widthM,
  )
  const urgency = clamp((19 - depth) / 12, 0, 1)
  const desiredDepth = clamp(
    Math.min(
      4 + urgency * (4.2 + quality * 1.8) + (advancingThreat ? .6 : 0),
      depth - (1.4 + .6 * (1 - quality)),
    ), 1.5, 11.5,
  )
  const target: Point2 = boundedTarget({
    xM: goalX + team.attackingDirection * desiredDepth,
    yM: clamp(
      centreY + (predictedY - centreY) *
        (desiredDepth / Math.max(depth, desiredDepth + .6)) * .92,
      centreY - pitch.goalWidthM / 2 - 1.65,
      centreY + pitch.goalWidthM / 2 + 1.65,
    ),
  }, pitch)

  // Engagement is permission to physically contest a dribbled ball, not
  // an outcome. The contact resolver still needs a real swept collision.
  const ownPenaltyDepth =
    (keeper.position.xM - goalX) * team.attackingDirection
  const canSmother = ownPenaltyDepth >= 0 &&
    ownPenaltyDepth <= pitch.penaltyAreaDepthM &&
    Math.abs(keeper.position.yM - centreY) <=
      pitch.penaltyAreaWidthM / 2 &&
    separationM(keeper.position, state.ball.position) <= 2.0 &&
    state.ball.heightM <= .45

  if (canSmother) {
    return { mode: 'smother', target, engage: true }
  }
  const ordinary = planGoalkeeperPosition(state, setup, keeper, team)
  // If the striker is not actively advancing and has space to be covered,
  // match the existing geometric stance instead of needless charging.
  if (!advancingThreat && depth > 13 && distance > 7.5 && ordinary) {
    return { mode: 'hold', target: ordinary.target, engage: false }
  }
  return {
    mode: 'close',
    target,
    engage: false,
  }
}

/** A lightweight 50ms pursuit adjustment, without waiting 12 tactical
 * ticks for an attacker already inside the danger area. Incoming shots
 * always win: a controlled dribble is the only eligible one-on-one phase.
 */
export function trackGoalkeeperOneOnOnes(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (state.kickoff?.phase === 'awaitingKick' ||
      state.ball.controllerId === null) return state
  const updates = new Map<string, GoalkeeperOneOnOneIntent>()
  for (const [index, team] of state.teams.entries()) {
    if (!state.ai.enabledTeams[index]) continue
    const keeper = state.players.find(p =>
      p.clubId === team.clubId && p.formationSlot === 'GK')
    if (!keeper) continue
    const intent = planGoalkeeperOneOnOne(state, setup, keeper, team)
    if (intent) updates.set(keeper.playerId, intent)
  }
  if (!updates.size) return state
  return {
    ...state,
    players: state.players.map(player => {
      const intent = updates.get(player.playerId)
      if (!intent) return player
      const old = player.intention
      const same = old.kind === 'moveToPoint' &&
        separationM(old.target, intent.target) < .2
      return {
        ...player,
        engagesBall: intent.engage,
        intention: same ? old : {
          kind: 'moveToPoint' as const,
          sinceTick: state.clock.tick, target: intent.target,
        },
      }
    }),
    ai: {
      ...state.ai,
      decisionSnapshot: state.ai.decisionSnapshot.map(decision => {
        const intent = updates.get(decision.playerId)
        return intent ? {
          ...decision, action: 'oneOnOne' as const,
          engage: intent.engage, target: intent.target,
        } : decision
      }),
    },
  }
}
