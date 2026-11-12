import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState } from '../match/state'
import { boundedTarget, separationM, supportTarget } from './coordination'
import { laneObstruction } from './possession'

/**
 * Local space search, not scripted runs. Every support location is chosen
 * from actual opponent positions, passing corridors, and formation anchors.
 * Small fixed candidate set keeps 22-player iPhone workloads bounded.
 */
export const SUPPORT_SPACE_VERSION = 'spatial-outlets-v1'
const MIN_OUTLET_DISTANCE_M = 5.5
const MAX_OUTLET_DISTANCE_M = 34
const MIN_SEPARATION_M = 5.2
const clamp = (v: number, low: number, high: number) =>
  Math.min(high, Math.max(low, v))

function flankOf(slot: PlayerMatchState['formationSlot']): -1 | 0 | 1 {
  if (slot === 'RW' || slot === 'RCM' || slot === 'RB') return 1
  if (slot === 'LW' || slot === 'LCM' || slot === 'LB') return -1
  return 0
}

/** Consistent +X and -X team-relative right/left discipline. */
export function keepTeamFlank(
  player: PlayerMatchState, desired: Point2,
  direction: 1 | -1, setup: MatchSetup,
): Point2 {
  const flank = flankOf(player.formationSlot)
  const gap = player.formationSlot === 'RCM' ||
    player.formationSlot === 'LCM' ? 3 : 7
  const centre = setup.pitch.widthM / 2
  const yM = flank === 0 ? desired.yM :
    flank * direction > 0 ? Math.max(centre + gap, desired.yM) :
      Math.min(centre - gap, desired.yM)
  return boundedTarget({ xM: desired.xM, yM }, setup.pitch)
}

function nearestOpponent(
  target: Point2, opponents: readonly PlayerMatchState[],
): number {
  let nearest = 100
  for (const opponent of opponents) {
    nearest = Math.min(nearest, separationM(target, opponent.position))
  }
  return nearest
}

function candidate(
  base: Point2, offsetForward: number, offsetSide: number,
  direction: 1 | -1, player: PlayerMatchState, setup: MatchSetup,
): Point2 {
  return keepTeamFlank(player, {
    xM: base.xM + offsetForward * direction,
    yM: base.yM + offsetSide * direction,
  }, direction, setup)
}

export interface SupportOpportunity {
  readonly playerId: string
  readonly target: Point2
  readonly utility: number
  /** Rough free-space estimate; not a pass completion probability. */
  readonly defenderGapM: number
  readonly laneObstruction: number
}

function supportOpportunity(
  player: PlayerMatchState,
  target: Point2, base: Point2, anchor: Point2,
  reference: Point2,
  opponents: readonly PlayerMatchState[],
  teammates: readonly PlayerMatchState[],
  reserved: readonly Point2[],
  direction: 1 | -1,
): SupportOpportunity | null {
  const distanceToCarrier = separationM(reference, target)
  if (distanceToCarrier < MIN_OUTLET_DISTANCE_M ||
      distanceToCarrier > MAX_OUTLET_DISTANCE_M) return null
  const fromAnchor = separationM(anchor, target)
  const maxFromAnchor = player.formationSlot === 'RCB' ||
    player.formationSlot === 'LCB' ? 19 :
    player.formationSlot === 'RB' ||
    player.formationSlot === 'LB' ||
    player.formationSlot === 'DM' ? 28 : 38
  if (fromAnchor > maxFromAnchor) return null
  const defenderGapM = nearestOpponent(target, opponents)
  const blocked = laneObstruction(reference, target, opponents)
  const crowded = teammates.reduce((penalty, teammate) => {
    if (teammate.playerId === player.playerId) return penalty
    // Most teammates will move; a smaller penalty prevents everybody from
    // selecting the same *currently* empty central pocket.
    const gap = separationM(teammate.position, target)
    return penalty + Math.max(0, 4.8 - gap) * .6
  }, 0)
  const spacing = reserved.reduce((penalty, alreadyChosen) =>
    penalty + Math.max(0, MIN_SEPARATION_M - separationM(alreadyChosen, target))
      * 5.2, 0)
  const forward = (target.xM - reference.xM) * direction
  const distScore = -Math.abs(distanceToCarrier - 17) * .35
  const lateral = Math.abs(target.yM - reference.yM)
  const angleBonus = Math.min(lateral, 10) * .36
  const backline = player.formationSlot === 'RCB' ||
    player.formationSlot === 'LCB' ||
    player.formationSlot === 'RB' ||
    player.formationSlot === 'LB' ||
    player.formationSlot === 'DM'
  const roleProgress = backline
    ? (forward > -5 ? -Math.max(0, forward + 5) * .8 : 0)
    : clamp(forward, -16, 15) * .22
  const utility =
    1.4 * Math.min(12, defenderGapM) -
    blocked * 3.1 - crowded - spacing +
    distScore + angleBonus + roleProgress -
    .33 * separationM(base, target) -
    .12 * separationM(player.position, target) -
    .08 * fromAnchor
  return { playerId: player.playerId, target, utility,
    defenderGapM, laneObstruction: blocked }
}

/**
 * Greedy team-level allocation: first reserve useful close support options,
 * then keep deeper/remote footballers in formation rather than piling onto
 * the same pocket. Deterministic ties use formation order/player IDs.
 */
export function chooseDynamicSupport(
  state: MatchState, setup: MatchSetup, teamId: string,
  reference: Point2, excludedIds: ReadonlySet<string>,
): ReadonlyMap<string, SupportOpportunity> {
  const team = state.teams.find(t => t.clubId === teamId)
  if (!team) throw new Error('Unknown team in support-space planner')
  const teammates = state.players.filter(p => p.clubId === teamId)
  const opponents = state.players.filter(p => p.clubId !== teamId)
  const eligible = teammates.filter(p =>
    p.formationSlot !== 'GK' && !excludedIds.has(p.playerId))
    .sort((a, b) => {
      const distanceDifference = separationM(a.position, reference) -
        separationM(b.position, reference)
      return distanceDifference || (a.playerId < b.playerId ? -1 :
        a.playerId > b.playerId ? 1 : 0)
    })
  const reserved: Point2[] = []
  const selected = new Map<string, SupportOpportunity>()
  // Candidate offsets use pitch metres; all targets keep proper flank roles.
  const offsets: readonly [number, number][] = [
    [0, 0], [0, -5], [0, 5], [-5, 0], [5, 0],
    [-5, -5], [-5, 5], [5, -5], [5, 5],
  ]
  for (const player of eligible) {
    const anchor = state.ai.formationPositions[player.playerId]
    if (!anchor) throw new Error('Missing support formation anchor')
    const base = supportTarget(
      player, anchor, reference, team.attackingDirection, setup)
    const considered: SupportOpportunity[] = []
    for (const [forward, sideways] of offsets) {
      const point = candidate(base, forward, sideways,
        team.attackingDirection, player, setup)
      const scored = supportOpportunity(player, point, base, anchor,
        reference, opponents, teammates, reserved, team.attackingDirection)
      if (scored) considered.push(scored)
    }
    considered.sort((a, b) => b.utility - a.utility ||
      a.target.xM - b.target.xM || a.target.yM - b.target.yM)
    const best = considered[0]
    if (best) {
      selected.set(player.playerId, best)
      reserved.push(best.target)
    } else {
      const fallback = keepTeamFlank(
        player, base, team.attackingDirection, setup)
      const open = nearestOpponent(fallback, opponents)
      selected.set(player.playerId, {
        playerId: player.playerId, target: fallback,
        utility: -50, defenderGapM: open,
        laneObstruction: laneObstruction(reference, fallback, opponents),
      })
      reserved.push(fallback)
    }
  }
  return selected
}
