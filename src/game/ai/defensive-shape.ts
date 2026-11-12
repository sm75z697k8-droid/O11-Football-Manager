import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, separationM } from './coordination'

/**
 * Phase 6.5 — Team-first defensive responsibilities.
 *
 * A role has a *home defensive zone* in its own attacking coordinates.
 * Only nearby threats inside a dangerous attacking corridor can override
 * recovery. The physics engine, not this planner, decides physical contact.
 */
export const DEFENSIVE_PLANNER_VERSION = 'compact-block-recovery-v1'
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n))

type AssignedAction = 'press' | 'cover' | 'mark' | 'recover' | 'shape'
export interface DefensiveAssignment {
  readonly action: AssignedAction
  readonly target: Point2
  readonly engage: boolean
}
const centreBack = (p: PlayerMatchState): boolean =>
  p.formationSlot === 'RCB' || p.formationSlot === 'LCB'
const defender = (p: PlayerMatchState): boolean =>
  centreBack(p) || p.formationSlot === 'LB' || p.formationSlot === 'RB'
const midfielder = (p: PlayerMatchState): boolean =>
  p.formationSlot === 'DM' || p.formationSlot === 'RCM' ||
  p.formationSlot === 'LCM'
const forwardProgress = (xM: number, length: number, direction: 1 | -1) =>
  direction === 1 ? xM : length - xM
const worldX = (progress: number, length: number, direction: 1 | -1) =>
  direction === 1 ? progress : length - progress

/** The zonal recovery point is always goal-side of the opposition attack
 * for central midfield and defence, without all players joining the chase.
 */
export function defensiveRecoveryTarget(
  player: PlayerMatchState, original: Point2, ball: Point2,
  team: TeamMatchState, setup: MatchSetup,
): Point2 {
  const { lengthM, widthM } = setup.pitch
  const direction = team.attackingDirection
  const ownAnchor = forwardProgress(original.xM, lengthM, direction)
  const ballProgress = forwardProgress(ball.xM, lengthM, direction)
  const slot = player.formationSlot
  if (slot === 'GK') {
    return boundedTarget({
      xM: worldX(clamp(ownAnchor, 2.5, 8), lengthM, direction),
      yM: widthM / 2 + clamp((ball.yM - widthM / 2) * .10, -2, 2),
    }, setup.pitch)
  }
  // Midfielders RECOVER behind the ball, rather than remaining upfield to
  // track an irrelevant opposing fullback. Attackers stay higher for outlets.
  const gap = centreBack(player) ? 18 :
    defender(player) ? 15 :
    slot === 'DM' ? 11 :
    slot === 'RCM' || slot === 'LCM' ? 7 :
    slot === 'RW' || slot === 'LW' ? 2 : -4
  const anchorShift = clamp((ballProgress - lengthM / 2) * .35, -24, 12)
  const shapeProgress = ownAnchor + anchorShift
  const lineLimit = ballProgress - gap
  const progress = clamp(Math.min(shapeProgress, lineLimit), 4, lengthM - 4)
  const yCentre = widthM / 2
  const baseShift = clamp((ball.yM - yCentre) * .24, -9, 9)
  let yM = original.yM + baseShift
  // Keep the team's established right/left identities. Wide attackers tuck
  // into a defensive midfield line but don't swap their flanks.
  const flank = slot === 'RCM' || slot === 'RW' || slot === 'RB' ? 1 :
    slot === 'LCM' || slot === 'LW' || slot === 'LB' ? -1 : 0
  if (flank) {
    const side = flank * direction
    const minChannel = midfielder(player) ? 2.5 : 5
    yM = side > 0 ? Math.max(yCentre + minChannel, yM) :
      Math.min(yCentre - minChannel, yM)
  }
  if (slot === 'ST') {
    yM = yCentre + clamp((ball.yM - yCentre) * .16, -4, 4)
  }
  return boundedTarget({
    xM: worldX(progress, lengthM, direction), yM,
  }, setup.pitch)
}

/** Only a threat near the ball and closer to OUR goal than the current
 * danger line should pull a player out of their defensive recovery slot.
 * Opponent centre-backs behind their own attack will never qualify.
 */
export function isRelevantDefensiveThreat(
  opponent: PlayerMatchState, ball: Point2,
  team: TeamMatchState, setup: MatchSetup,
): boolean {
  if (opponent.formationSlot === 'GK') return false
  const length = setup.pitch.lengthM
  const ballProgress = forwardProgress(ball.xM, length, team.attackingDirection)
  const opponentProgress = forwardProgress(
    opponent.position.xM, length, team.attackingDirection)
  return opponentProgress <= Math.min(length * .80, ballProgress + 13) &&
    opponentProgress >= Math.max(0, ballProgress - 38)
}

function keeperPenalty(player: PlayerMatchState) {
  return defender(player) ? 2.5 :
    player.formationSlot === 'DM' ? .6 : 0
}

function primaryPressers(
  teammates: readonly PlayerMatchState[], ball: Point2,
  team: TeamMatchState,
): PlayerMatchState[] {
  const intensity = team.pressingIntensity
  const desired = intensity === 'high' ? 2 : intensity === 'standard' ? 1 : 1
  const radius = intensity === 'high' ? 38 : intensity === 'standard' ? 30 : 16
  const candidates = teammates.filter(p =>
    p.formationSlot !== 'GK' &&
    separationM(p.position, ball) <= radius)
    .sort((a, b) => {
      const score = (p: PlayerMatchState) =>
        separationM(p.position, ball) / 6.5 + keeperPenalty(p)
      return score(a) - score(b) ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
    })
  // Low pressing protects shape unless ball enters an accessible zone.
  return candidates.slice(0, desired)
}

function defensiveCover(
  teammates: readonly PlayerMatchState[], ball: Point2,
  team: TeamMatchState, setup: MatchSetup, excluded: ReadonlySet<string>,
): PlayerMatchState | null {
  const goalSideX = ball.xM - team.attackingDirection * 7
  const reference = boundedTarget({
    xM: goalSideX, yM: ball.yM,
  }, setup.pitch)
  const choices = teammates.filter(p =>
    p.formationSlot !== 'GK' && !excluded.has(p.playerId))
  choices.sort((a, b) => {
    const score = (p: PlayerMatchState) =>
      separationM(p.position, reference) +
      (p.formationSlot === 'DM' ? -2.5 :
        midfielder(p) ? 0 : centreBack(p) ? 3 : 8)
    return score(a) - score(b) ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  })
  return choices[0] ?? null
}

function markTargetNearBlock(
  block: Point2, opponent: PlayerMatchState,
  team: TeamMatchState, setup: MatchSetup,
): Point2 {
  const threatGoalSide = boundedTarget({
    xM: opponent.position.xM - team.attackingDirection * 2.8,
    yM: opponent.position.yM,
  }, setup.pitch)
  const offset = separationM(block, threatGoalSide)
  const factor = offset > 8 ? 8 / offset : 1
  return boundedTarget({
    xM: block.xM + (threatGoalSide.xM - block.xM) * factor,
    yM: block.yM + (threatGoalSide.yM - block.yM) * factor,
  }, setup.pitch)
}

/** One consistent world snapshot assigns pressing, covering, marking, and
 * recovery roles. Exactly one assignment per team player, no side effects.
 */
export function planDefensiveResponsibilities(
  state: MatchState, setup: MatchSetup, team: TeamMatchState,
  ballPoint: Point2,
): ReadonlyMap<string, DefensiveAssignment> {
  const teammates = state.players.filter(p => p.clubId === team.clubId)
  const opponents = state.players.filter(p => p.clubId !== team.clubId)
  const pressing = primaryPressers(teammates, ballPoint, team)
  const pressingIds = new Set(pressing.map(p => p.playerId))
  const cover = defensiveCover(
    teammates, ballPoint, team, setup, pressingIds)
  const assignments = new Map<string, DefensiveAssignment>()
  const marked = new Set<string>()
  for (const player of teammates) {
    const original = state.ai.formationPositions[player.playerId]
    if (!original) throw new Error('Missing defensive formation anchor')
    const block = defensiveRecoveryTarget(
      player, original, ballPoint, team, setup)
    let action: AssignedAction = 'recover'
    let target = block
    let engage = false
    if (player.formationSlot === 'GK') action = 'shape'
    else if (pressingIds.has(player.playerId)) {
      action = 'press'
      engage = true
      // Current controller is the physical threat. The 50ms movement engine
      // approaches the actual ball, not a fake successful tackle.
      target = boundedTarget(ballPoint, setup.pitch)
    } else if (cover?.playerId === player.playerId) {
      action = 'cover'
      target = boundedTarget({
        xM: ballPoint.xM - team.attackingDirection * 7,
        yM: ballPoint.yM +
          (player.position.yM <= ballPoint.yM ? -3.5 : 3.5),
      }, setup.pitch)
    } else if (midfielder(player) || defender(player) ||
      player.formationSlot === 'RW' || player.formationSlot === 'LW') {
      const candidates = opponents.filter(p =>
        !marked.has(p.playerId) &&
        isRelevantDefensiveThreat(p, ballPoint, team, setup) &&
        separationM(p.position, block) <= 13)
        .sort((a, b) =>
          separationM(a.position, block) - separationM(b.position, block) ||
          (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
      const threat = candidates[0]
      if (threat) {
        action = 'mark'
        marked.add(threat.playerId)
        target = markTargetNearBlock(block, threat, team, setup)
      }
    }
    assignments.set(player.playerId, {
      action, target, engage,
    })
  }
  return assignments
}
