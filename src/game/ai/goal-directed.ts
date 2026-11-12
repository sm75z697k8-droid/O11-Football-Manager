import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, predictBallAt, separationM } from './coordination'

/**
 * Phase 6.7 — objective-driven attacking options.
 * These are deterministic EXPECTED-OPPORTUNITY estimates, never generated
 * goals or xG claims. The actual kicked ball and goalkeeper decide outcomes.
 */
export const GOAL_DIRECTED_AI_VERSION = 'shooting-and-chance-creation-v1'
const clamp = (v: number, low: number, high: number) =>
  Math.min(high, Math.max(low, v))

const goalX = (direction: 1 | -1, length: number) =>
  direction === 1 ? length : 0

export interface ShootingOpportunity {
  readonly target: Point2
  readonly power: number
  readonly lift: number
  readonly utility: number
  readonly chanceQuality: number
}

/** Defender occlusion of the actual shooting segment. This does not
 * adjudicate an interception; it estimates visible shooting space.
 */
export function shootingCorridorObstruction(
  from: Point2, to: Point2,
  opponents: readonly PlayerMatchState[],
): number {
  const dx = to.xM - from.xM
  const dy = to.yM - from.yM
  const segment = dx * dx + dy * dy
  let obstruction = 0
  if (segment < .001) return 100
  for (const p of opponents) {
    if (p.formationSlot === 'GK') continue
    const t = clamp(
      ((p.position.xM - from.xM) * dx +
        (p.position.yM - from.yM) * dy) / segment,
      0, 1,
    )
    if (t < .08 || t > .93) continue
    const separation = Math.hypot(
      from.xM + t * dx - p.position.xM,
      from.yM + t * dy - p.position.yM,
    )
    obstruction += Math.max(0, 2.7 - separation) * 1.9
  }
  return obstruction
}

/** A relative measure for what a RECEIVER could produce if they got the
 * ball in this location, allowing combinations to create better chances.
 */
export function attackingOpportunityAt(
  position: Point2, team: TeamMatchState,
  setup: MatchSetup,
  opponents: readonly PlayerMatchState[],
): number {
  const distanceToLine = team.attackingDirection === 1
    ? setup.pitch.lengthM - position.xM : position.xM
  const lateral = Math.abs(position.yM - setup.pitch.widthM / 2)
  if (distanceToLine > 34 || distanceToLine < .4 || lateral > 18) return 0
  const centre = {
    xM: goalX(team.attackingDirection, setup.pitch.lengthM),
    yM: setup.pitch.widthM / 2,
  }
  const obstruction = shootingCorridorObstruction(position, centre, opponents)
  const proximity = clamp((34 - distanceToLine) / 26, 0, 1)
  const angle = clamp(1 - lateral / (distanceToLine * .5 + 4), .08, 1)
  return clamp((proximity * angle * 19) - obstruction * 2.4, 0, 19)
}

/** Create one physically executable shot option only when the player has a
 * credible sight of the frame. Actual accuracy & goal-line crossing remain
 * entirely governed by the engine's kick and ball physics.
 */
export function evaluateShootingOpportunity(
  shooter: PlayerMatchState, definition: PlayerDefinition,
  opponents: readonly PlayerMatchState[],
  team: TeamMatchState, setup: MatchSetup,
): ShootingOpportunity | null {
  if (shooter.formationSlot === 'GK') return null
  const length = setup.pitch.lengthM
  const distanceToLine = team.attackingDirection === 1
    ? length - shooter.position.xM : shooter.position.xM
  const lateral = Math.abs(shooter.position.yM - setup.pitch.widthM / 2)
  if (distanceToLine < 1 || distanceToLine > 26 ||
      lateral > Math.min(17, distanceToLine * .5 + 4)) return null
  const keeper = opponents.find(p => p.formationSlot === 'GK')
  const keeperSide = keeper &&
    keeper.position.yM > setup.pitch.widthM / 2 ? -1 : 1
  const intendedY = setup.pitch.widthM / 2 + keeperSide *
    Math.min(2.4, setup.pitch.goalWidthM / 2 - .6)
  const target = {
    xM: goalX(team.attackingDirection, length),
    yM: intendedY,
  }
  const obstruction = shootingCorridorObstruction(shooter.position, target, opponents)
  const a = definition.abilities
  const technique = a.technical.technique
  const quality = (
    .45 * a.technical.finishing +
    .20 * a.technical.longShots +
    .18 * technique +
    .17 * a.mental.composure
  ) / 100
  const range = clamp(1 - Math.max(0, distanceToLine - 7) / 29, .15, 1)
  const angle = clamp(1 - lateral / (distanceToLine * .55 + 4), .1, 1)
  const chanceQuality = quality * range * angle *
    clamp(1 - obstruction * .12, .1, 1)
  const utility = 43 + chanceQuality * 34 -
    distanceToLine * .40 - lateral * .27 - obstruction * 3
  const power = clamp(.74 + distanceToLine * .009, .76, .98)
  const lift = distanceToLine < 15 ? .09 : .12
  return { target, power, lift, utility, chanceQuality }
}

/** Existing match commands identify a real shot; a normal pass or diagnostic
 * ball launch cannot trigger goalkeeper reactions or fabricated saves.
 */
export function activePhysicalShot(
  state: MatchState,
): { shooterId: string; tick: number } | null {
  if (state.ball.controllerId !== null || state.ball.outsidePitch) return null
  const last = [...state.contactEvents].reverse().find(e =>
    e.outcome === 'kicked' && e.commandId.startsWith('ai-shot-'))
  if (!last || state.clock.tick - last.tick > 85 ||
      state.ball.lastTouchPlayerId !== last.playerId) return null
  return { shooterId: last.playerId, tick: last.tick }
}

export interface GoalkeeperSaveIntent {
  readonly target: Point2
  readonly engage: boolean
}

export function planGoalkeeperSave(
  state: MatchState, setup: MatchSetup, keeper: PlayerMatchState,
  team: TeamMatchState,
): GoalkeeperSaveIntent | null {
  if (keeper.formationSlot !== 'GK' || keeper.clubId !== team.clubId) return null
  const shot = activePhysicalShot(state)
  const shooter = shot && state.players.find(p => p.playerId === shot.shooterId)
  if (!shooter || shooter.clubId === team.clubId) return null
  const ownGoal = team.attackingDirection === 1 ? 0 : setup.pitch.lengthM
  const towardsOwnGoal = ownGoal === 0 ? -1 : 1
  const speedTowards = state.ball.velocity.xMps * towardsOwnGoal
  const distance = Math.abs(ownGoal - state.ball.position.xM)
  if (speedTowards < 1.5 || distance > 35) return null
  const seconds = clamp((distance - 3) / speedTowards, 0, 2.6)
  const predicted = predictBallAt(state.ball, seconds)
  const halfMouth = setup.pitch.goalWidthM / 2
  if (Math.abs(predicted.position.yM - setup.pitch.widthM / 2) >
    halfMouth + 2.6) return null
  // A compact keeper zone, NOT an instantaneous teleport. When feasible,
  // ordinary player locomotion must get the keeper to the save location.
  const goalSideX = ownGoal === 0 ? 2.8 : setup.pitch.lengthM - 2.8
  const target = boundedTarget({
    xM: goalSideX,
    yM: clamp(predicted.position.yM,
      setup.pitch.widthM / 2 - halfMouth - 1.2,
      setup.pitch.widthM / 2 + halfMouth + 1.2),
  }, setup.pitch)
  return { target, engage: true }
}

/** A save pursuit needs faster corrections than the twelve-tick tactical
 * cycle, because a hard 20-30m shot can cross the goalmouth in one second.
 */
export function trackGoalkeeperSaves(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (state.kickoff?.phase === 'awaitingKick') return state
  const updates = new Map<string, GoalkeeperSaveIntent>()
  for (const [index, team] of state.teams.entries()) {
    if (!state.ai.enabledTeams[index]) continue
    const keeper = state.players.find(p =>
      p.clubId === team.clubId && p.formationSlot === 'GK')
    if (!keeper) continue
    const save = planGoalkeeperSave(state, setup, keeper, team)
    if (save) updates.set(keeper.playerId, save)
  }
  if (!updates.size) return state
  return {
    ...state,
    players: state.players.map(p => {
      const save = updates.get(p.playerId)
      if (!save) return p
      const old = p.intention
      const same = old.kind === 'moveToPoint' &&
        separationM(old.target, save.target) < .2
      return {
        ...p, engagesBall: true,
        intention: same ? old : {
          kind: 'moveToPoint' as const,
          sinceTick: state.clock.tick, target: save.target,
        },
      }
    }),
    ai: {
      ...state.ai,
      decisionSnapshot: state.ai.decisionSnapshot.map(d => {
        const save = updates.get(d.playerId)
        return save ? {
          ...d, action: 'save' as const, engage: true, target: save.target,
        } : d
      }),
    },
  }
}
