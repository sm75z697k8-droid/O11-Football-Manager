import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type { PlayerMatchState, TeamMatchState } from '../match/state'
import {
  attackingOpportunityAt, evaluateShootingOpportunity,
  shootingCorridorObstruction,
} from './goal-directed'

/**
 * A one-action tactical follow-up estimate, NEVER a simulated possession.
 *
 * Called only for a previously physically viable pass. The positions below
 * are short-horizon player projections, not awarded receptions or teleports.
 * A receiver may still miscontrol the ball, lose it, turn poorly, or fail
 * the subsequent real-world kick and interception.
 */
export const RECEIVER_CONTINUATION_VERSION = 'one-action-scanning-v1'
export const MAX_CONTINUATION_ADJUSTMENT = 6.5

export type FollowUpKind = 'shoot' | 'carry' | 'combine' | 'protect'

export interface ReceiverContinuation {
  readonly kind: FollowUpKind
  /** Tactical utility delta; NOT an expected number of goals. */
  readonly adjustment: number
  readonly reason: string
  readonly potentialReceiverId: string | null
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)
const closest = (point: Point2, opponents: readonly PlayerMatchState[]) =>
  opponents.reduce((gap, p) => Math.min(gap, distance(point, p.position)), 100)

function corridorObstruction(
  from: Point2, to: Point2,
  opponents: readonly PlayerMatchState[],
): number {
  const dx = to.xM - from.xM
  const dy = to.yM - from.yM
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1) return 100
  let obstruction = 0
  for (const defender of opponents) {
    const fraction = clamp(
      ((defender.position.xM - from.xM) * dx +
        (defender.position.yM - from.yM) * dy) / lenSq,
      0, 1)
    if (fraction < .12 || fraction > .92) continue
    const gap = Math.hypot(
      defender.position.xM - (from.xM + fraction * dx),
      defender.position.yM - (from.yM + fraction * dy))
    obstruction += Math.max(0, 2.8 - gap) * 1.9
  }
  return obstruction
}

export function evaluateReceiverContinuation(
  receiver: PlayerMatchState,
  receiverDefinition: PlayerDefinition,
  receptionPoint: Point2,
  passerId: string,
  team: TeamMatchState,
  setup: MatchSetup,
  projectedTeammates: readonly PlayerMatchState[],
  projectedOpponents: readonly PlayerMatchState[],
): ReceiverContinuation {
  const protect: ReceiverContinuation = {
    kind: 'protect', adjustment: 0,
    reason: 'Receiver has no established forward continuation',
    potentialReceiverId: null,
  }
  if (receiver.formationSlot === 'GK') return protect
  const remaining = team.attackingDirection === 1
    ? setup.pitch.lengthM - receptionPoint.xM : receptionPoint.xM
  // The short-horizon model is only useful close enough that the next
  // action could genuinely influence the attack. No mid-pitch pass bonus.
  if (remaining > 36 || remaining < 2) return protect

  const abilities = receiverDefinition.abilities
  const control = (.45 * abilities.technical.firstTouch +
    .32 * abilities.mental.composure +
    .23 * abilities.mental.decisions) / 100
  const nearest = closest(receptionPoint, projectedOpponents)
  const contactWindow = clamp((nearest - 1.5) / 4, 0, 1)
  // This confidence is a heuristic modifier, not a pass-success roll.
  const readiness = contactWindow * (.73 + .27 * control)
  if (readiness < .30) return {
    ...protect, adjustment: -1.8 * (1 - readiness),
    reason: 'Likely immediate pressure prevents a useful next action',
  }

  const chanceHere = attackingOpportunityAt(
    receptionPoint, team, setup, projectedOpponents)
  let bestKind: FollowUpKind = 'protect'
  let bestScore = 0
  let bestId: string | null = null

  // 1) Could the receiver themselves have an unobstructed shot?
  const shot = evaluateShootingOpportunity(
    { ...receiver, position: receptionPoint }, receiverDefinition,
    projectedOpponents, team, setup)
  if (shot && shot.chanceQuality > .15 &&
      shootingCorridorObstruction(
        receptionPoint, shot.target, projectedOpponents) < 2.6) {
    const score = clamp(
      (shot.chanceQuality - .15) * 14 + (26 - remaining) * .09,
      0, 6.5)
    if (score > bestScore) {
      bestKind = 'shoot'
      bestScore = score
    }
  }

  // 2) A purposeful short carry into space can be better than recycling.
  for (const sideways of [-3.5, 0, 3.5]) {
    const target = {
      xM: receptionPoint.xM + team.attackingDirection * 5.5,
      yM: clamp(receptionPoint.yM + sideways, 3.1,
        setup.pitch.widthM - 3.1),
    }
    if (target.xM < 3.1 || target.xM > setup.pitch.lengthM - 3.1)
      continue
    const gap = closest(target, projectedOpponents)
    const blocked = corridorObstruction(
      receptionPoint, target, projectedOpponents)
    if (gap < 3.8 || blocked > 1.4) continue
    const improved = attackingOpportunityAt(
      target, team, setup, projectedOpponents) - chanceHere
    const score = clamp(
      improved * .55 + (gap > 6 ? 1.1 : 0) - blocked,
      0, 5)
    if (score > bestScore) {
      bestKind = 'carry'
      bestScore = score
      bestId = null
    }
  }

  // 3) A third player might be a reachable, open *next* passing outlet.
  // This is a geometric forecast only. We never invent the second pass.
  for (const teammate of projectedTeammates) {
    if (teammate.playerId === receiver.playerId ||
        teammate.playerId === passerId ||
        teammate.formationSlot === 'GK') continue
    const point = teammate.position
    const length = distance(receptionPoint, point)
    const progress = (point.xM - receptionPoint.xM) *
      team.attackingDirection
    if (length < 5 || length > 23 || progress < 3) continue
    const open = closest(point, projectedOpponents)
    const obstruction = corridorObstruction(
      receptionPoint, point, projectedOpponents)
    if (open < 4.6 || obstruction > 1.3) continue
    const nextChance = attackingOpportunityAt(
      point, team, setup, projectedOpponents)
    const gain = nextChance - chanceHere
    if (gain < 1.5) continue
    const score = clamp(
      gain * .47 + Math.min(2, progress * .12) -
      Math.max(0, 7 - open) * .3 - Math.max(0, length - 16) * .10,
      0, 6)
    if (score > bestScore) {
      bestKind = 'combine'
      bestScore = score
      bestId = teammate.playerId
    }
  }

  if (bestKind === 'protect') return {
    ...protect,
    adjustment: nearest < 4 ? -1.3 : -.55,
    reason: 'Little credible progress after the intended reception',
  }
  const mentalAwareness = (
    abilities.mental.decisions + abilities.mental.vision) / 200
  // Better scanning increases the value of a plausible next action, but
  // no player's attributes guarantee its execution.
  return {
    kind: bestKind,
    adjustment: clamp(bestScore * readiness *
      (.78 + .22 * mentalAwareness), 0, MAX_CONTINUATION_ADJUSTMENT),
    potentialReceiverId: bestId,
    reason: bestKind === 'shoot'
      ? 'Receiver can find a credible shooting lane'
      : bestKind === 'carry'
        ? 'Receiver can carry into genuine shooting space'
        : 'Receiver can combine with an open advanced teammate',
  }
}
