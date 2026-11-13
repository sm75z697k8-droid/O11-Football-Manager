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
// Version identifier below reflects the active physical pressure policy.
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

/**
 * Phase 6.9O — intent-based, team-limited defensive pressure.
 *
 * Distances are deliberately estimated tactical calibrations, not a model
 * trained on professional tracking data. Real movement and tackles remain
 * in the 50ms physics engine.
 */
export const DEFENSIVE_PLANNER_VERSION = 'disciplined-pressure-triggers-p69o-v1'
export const PRESSING_SWITCH_MARGIN_M = 3.5

interface PressContext {
  readonly carrier: PlayerMatchState | undefined
  readonly goalDistanceM: number
  readonly trappedWide: boolean
  readonly drivingAtGoal: boolean
  readonly settledReception: boolean
}

function pressContext(
  state: MatchState, ballPoint: Point2, team: TeamMatchState,
  setup: MatchSetup,
): PressContext {
  const carrier = state.players.find(p =>
    p.playerId === state.ball.controllerId && p.clubId !== team.clubId)
  const goalDistanceM = forwardProgress(
    ballPoint.xM, setup.pitch.lengthM, team.attackingDirection)
  const trappedWide = ballPoint.yM < 9 ||
    ballPoint.yM > setup.pitch.widthM - 9
  // Genuine goalward momentum is more threatening than a sideways jog.
  const drivingAtGoal = !!carrier &&
    carrier.velocity.xMps * team.attackingDirection < -1.1
  // The latest relevant first touch matters, not the entire ever-growing
  // event history. Reverse scan with no .filter/.map allocations on iPhone.
  let lastControlled = -1000
  if (carrier) {
    for (let i = state.contactEvents.length - 1; i >= 0; i--) {
      const e = state.contactEvents[i]
      if (e.playerId === carrier.playerId && e.outcome === 'controlled') {
        lastControlled = e.tick
        break
      }
    }
    for (let i = state.automaticContactEvents.length - 1; i >= 0; i--) {
      const e = state.automaticContactEvents[i]
      if (e.playerId === carrier.playerId &&
          (e.outcome === 'intercepted' || e.outcome === 'wonChallenge')) {
        lastControlled = Math.max(lastControlled, e.tick)
        break
      }
    }
  }
  const settledReception = !!carrier &&
    state.clock.tick - lastControlled <= 8 &&
    state.clock.tick - lastControlled >= 0
  return { carrier, goalDistanceM, trappedWide,
    drivingAtGoal, settledReception }
}

/** Does not award a tackle, press success or possession. It answers only
 * whether this player should abandon shape to close down the ball NOW.
 * Low pressing can allow nonthreatening possession with no active presser.
 */
export function shouldPressCarrier(
  player: PlayerMatchState, ballPoint: Point2,
  team: TeamMatchState, context: PressContext,
): boolean {
  if (player.formationSlot === 'GK') return false
  const distance = separationM(player.position, ballPoint)
  const emergency = context.goalDistanceM <= 26
  const immediateContact = distance <= 3.5
  // Pressing is a deliberate event, not a permanent radius around the ball.
  // Nearby but unthreatening ownership is CONTAINED from shape, not chased.
  const triggered = team.pressingIntensity === 'low'
    ? (emergency && distance <= 10) || distance <= 3.2
    : team.pressingIntensity === 'standard'
      ? immediateContact ||
        (emergency && distance <= 11) ||
        (context.goalDistanceM <= 38 && distance <= 6.5) ||
        (context.trappedWide && distance <= 8.5) ||
        (context.drivingAtGoal && distance <= 8.5) ||
        (context.settledReception && distance <= 14)
      : distance <= (emergency ? 22 : 18) +
        ((context.trappedWide || context.drivingAtGoal ||
          context.settledReception) ? 3 : 0)
  if (!triggered) return false
  // A centre-back must protect the last line unless a real near-foot
  // challenge or an immediate goal threat justifies breaking that line.
  if (centreBack(player) && !emergency && !immediateContact) return false
  return true
}

function primaryPressers(
  state: MatchState, setup: MatchSetup,
  teammates: readonly PlayerMatchState[], ball: Point2,
  team: TeamMatchState, preferredPlayerId?: string,
): PlayerMatchState[] {
  const context = pressContext(state, ball, team, setup)
  const previousPressIds = new Set(state.ai.decisionSnapshot
    .filter(d => d.clubId === team.clubId && d.action === 'press')
    .map(d => d.playerId))
  // Keep free-ball racing separate from controlled-carrier pressing.
  // A real nominated recovery player is still allowed to chase a loose ball.
  const candidates = teammates.filter(p =>
    p.formationSlot !== 'GK' &&
    (context.carrier
      ? shouldPressCarrier(p, ball, team, context)
      : separationM(p.position, ball) <=
        (team.pressingIntensity === 'high' ? 30 : 23) ||
        p.playerId === preferredPlayerId))
    .map(p => {
      const distance = separationM(p.position, ball)
      const anchor = state.ai.formationPositions[p.playerId]
      const recover = anchor
        ? defensiveRecoveryTarget(p, anchor, ball, team, setup)
        : p.position
      const leavingShape = separationM(p.position, recover)
      const score = distance + keeperPenalty(p) * 2.3 +
        leavingShape * .10 -
        // Modest continuity: one slightly closer colleague should not
        // instantly reverse 6v6 pressing responsibility every 0.6 seconds.
        (context.carrier && previousPressIds.has(p.playerId)
          ? PRESSING_SWITCH_MARGIN_M : 0) -
        (!context.carrier && p.playerId === preferredPlayerId ? 20 : 0)
      return {player:p,score,distance}
    })
    .sort((a, b) => a.score - b.score ||
      (a.player.playerId < b.player.playerId ? -1 :
        a.player.playerId > b.player.playerId ? 1 : 0))
  const primary = candidates[0]
  if (!primary) return []
  if (team.pressingIntensity !== 'high') return [primary.player]
  const second = candidates.find(p => p.player.playerId !== primary.player.playerId &&
    p.distance <= 14 &&
    // Two straight-line chasers are reserved for a *real* trap, not
    // the default response to a midfielder holding the ball.
    (context.trappedWide || context.goalDistanceM <= 24 ||
      context.settledReception))
  return second ? [primary.player, second.player] : [primary.player]
}

/** Goal-side approach while outside immediate challenge range. Only
 * physically closing inside 3.5m switches to the ball's exact position.
 * The contact solver—not this intention—decides actual tackle outcomes.
 */
export function pressingApproachTarget(
  player: PlayerMatchState, ball: Point2,
  team: TeamMatchState, setup: MatchSetup,
): Point2 {
  if (separationM(player.position, ball) <= 3.5)
    return boundedTarget(ball, setup.pitch)
  return boundedTarget({
    xM: ball.xM - team.attackingDirection * 1.9,
    yM: ball.yM + clamp(
      (player.position.yM - ball.yM) * .16, -1.3, 1.3),
  }, setup.pitch)
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
  ballPoint: Point2, preferredRecoveryId?: string,
): ReadonlyMap<string, DefensiveAssignment> {
  const teammates = state.players.filter(p => p.clubId === team.clubId)
  const opponents = state.players.filter(p => p.clubId !== team.clubId)
  const pressing = primaryPressers(state, setup, teammates, ballPoint, team, preferredRecoveryId)
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
      target = pressingApproachTarget(player, ballPoint, team, setup)
    } else if (cover?.playerId === player.playerId) {
      action = 'cover'
      // Goal-side containment should SCREEN the carrier, not drag a
      // second non-engaging defender 25 metres out of the formation.
      // The prescribed tactical displacement is bounded from this
      // footballer's own defensive recovery point.
      const ideal = boundedTarget({
        xM: ballPoint.xM - team.attackingDirection * 7,
        yM: ballPoint.yM +
          (player.position.yM <= ballPoint.yM ? -3.5 : 3.5),
      }, setup.pitch)
      const gap = separationM(block, ideal)
      const maximumShift = team.pressingIntensity === 'low' ? 7 :
        team.pressingIntensity === 'standard' ? 10 : 13
      const ratio = gap > maximumShift ? maximumShift / gap : 1
      target = boundedTarget({
        xM: block.xM + (ideal.xM - block.xM) * ratio,
        yM: block.yM + (ideal.yM - block.yM) * ratio,
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
