import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState } from '../match/state'
import { boundedTarget, separationM, supportTarget } from './coordination'
import { laneObstruction } from './possession'
import { attackingOpportunityAt } from './goal-directed'
import { planThirdManRun, planWideUnderlap } from './combination-runs'
import { planCoordinatedAttack } from './attack-coordination'

/**
 * Local space search, not scripted runs. Every support location is chosen
 * from actual opponent positions, passing corridors, and formation anchors.
 * Small fixed candidate set keeps 22-player iPhone workloads bounded.
 */
export const SUPPORT_SPACE_VERSION = 'team-reserved-multi-role-support-att-s1-v1'
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
  direction: 1 | -1, attackingChance = 0,
): SupportOpportunity | null {
  const distanceToCarrier = separationM(reference, target)
  if (distanceToCarrier < MIN_OUTLET_DISTANCE_M ||
      distanceToCarrier > MAX_OUTLET_DISTANCE_M) return null
  const fromAnchor = separationM(anchor, target)
  const maxFromAnchor = player.formationSlot === 'RCB' ||
    player.formationSlot === 'LCB' ? 19 :
    player.formationSlot === 'RB' ||
    player.formationSlot === 'LB'
      ? player.duty === 'defend' ? 28 : 56 :
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
  // Higher-value final-third positions matter only when they actually
  // offer a usable shot corridor and sufficient defender separation.
  // This is a role-sensitive tactical bonus, not a scripted goal/shot.
  const utility =
    1.4 * Math.min(12, defenderGapM) -
    blocked * 3.1 - crowded - spacing +
    distScore + angleBonus + roleProgress +
    attackingChance * Math.min(1, defenderGapM / 5) -
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
  // Exactly one runner can offer a third-man combination after a genuine
  // kicked pass. The existing receiver still pursues the physical ball.
  const combination = planThirdManRun(state, setup, teamId) ??
    planWideUnderlap(state, setup, teamId)
  // Reserve the pre-existing physical third-man/underlap first. A new
  // attacking run must never overwrite the intended receiver or steal
  // the space a real kicked-pass combination is already using.
  if(combination && !excludedIds.has(combination.playerId)) {
    const runner=teammates.find(p=>p.playerId===combination.playerId)
    const anchor=state.ai.formationPositions[combination.playerId]
    if(runner&&anchor){
      const scored=supportOpportunity(runner,combination.target,
        supportTarget(runner,anchor,reference,
          team.attackingDirection,setup),anchor,reference,
        opponents,teammates,reserved,team.attackingDirection,
        combination.utilityBonus)
      if(scored){
        selected.set(runner.playerId,scored)
        reserved.push(scored.target)
      }
    }
  }
  // Team-level view: a winger, arriving CM, linking striker and (only
  // where safe) a fullback offer complementary targets. The existing
  // physics, on-ball decision planner and other support search still own
  // execution and all non-reserved movement.
  const coordinated=planCoordinatedAttack(state,setup,teamId,new Set([
    ...excludedIds,...selected.keys(),
  ]))
  for(const run of coordinated.values()){
    const runner=teammates.find(p=>p.playerId===run.playerId)
    const anchor=state.ai.formationPositions[run.playerId]
    if(!runner||!anchor)continue
    const scored=supportOpportunity(runner,run.target,
      supportTarget(runner,anchor,reference,team.attackingDirection,setup),
      anchor,reference,opponents,teammates,reserved,
      team.attackingDirection,run.utilityBonus)
    if(!scored)continue
    selected.set(run.playerId,scored)
    reserved.push(scored.target)
  }
  const attackDistance = team.attackingDirection === 1
    ? setup.pitch.lengthM - reference.xM : reference.xM
  // Only an actually controlled team attack can trigger an aggressive run.
  // A team merely favored in a loose-ball race still prioritizes support.
  const controlledAttack = state.players.some(p =>
    p.playerId === state.ball.controllerId && p.clubId === teamId)
  const penetrativePhase = controlledAttack &&
    attackDistance >= 9 && attackDistance <= 34
  const forward = (point: Point2) =>
    point.xM * team.attackingDirection
  const secondLastDefender = opponents.map(p => forward(p.position))
    .sort((a,b) => b - a)[1]
  // Approximate an offside-aware ceiling for new run TARGETS. The actual
  // football offside law is not implemented, so this does not adjudicate
  // or promise legal positions; it avoids obvious behind-the-line runs.
  const ballForward = forward(reference)
  const forwardLimit = Math.max(ballForward,
    (secondLastDefender ?? ballForward) - 1.25)
  const centreY = setup.pitch.widthM / 2
  // Preserve one true wide outlet while the other forward explores a
  // half-space. Choose the less closely marked inside lane, not a fixed
  // hardcoded right/left attacker.
  const laneClearance = (side: -1 | 1) => {
    const position = {xM: reference.xM + team.attackingDirection * 9,
      yM: centreY + side * team.attackingDirection * 11}
    return nearestOpponent(position, opponents)
  }
  const ballSide = (reference.yM - centreY) * team.attackingDirection
  const insideSide: -1 | 1 = Math.abs(ballSide) > 4
    ? (ballSide > 0 ? -1 : 1)
    : laneClearance(1) >= laneClearance(-1) ? 1 : -1
  // Candidate offsets use pitch metres; all targets keep proper flank roles.
  const offsets: readonly [number, number][] = [
    [0, 0], [0, -5], [0, 5], [-5, 0], [5, 0],
    [-5, -5], [-5, 5], [5, -5], [5, 5],
  ]
  for (const player of eligible) {
    if(selected.has(player.playerId))continue
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
    // Wingers formerly held the chalk even on final-third attacks, leaving
    // almost no usable shooting position or additional keeper work. Explore
    // three inside channels at realistic runner distances instead of
    // teleporting to the box or forcing a shot.
    if (penetrativePhase &&
        (player.formationSlot === 'RW' || player.formationSlot === 'LW') &&
        flankOf(player.formationSlot) === insideSide) {
      const side = flankOf(player.formationSlot) *
        team.attackingDirection
      const advance = clamp(attackDistance * .37, 6, 12)
      const candidateProgress = Math.min(
        ballForward + advance, forwardLimit)
      for (const gapM of [9, 12, 15]) {
        for (const retreat of [0, 3]) {
          const wanted = keepTeamFlank(player, {
            xM: team.attackingDirection * (candidateProgress - retreat),
            yM: centreY + side * gapM,
          }, team.attackingDirection, setup)
          // Long diagonal cuts are made in successive physical running
          // phases. A single tactical refresh cannot assign a winger a
          // wildly remote target while deleting nearby passing outlets.
          const runDistance = separationM(player.position, wanted)
          const fraction = runDistance > 18 ? 18 / runDistance : 1
          const point = keepTeamFlank(player,{
            xM: player.position.xM +
              (wanted.xM - player.position.xM) * fraction,
            yM: player.position.yM +
              (wanted.yM - player.position.yM) * fraction,
          },team.attackingDirection,setup)
          // Cut inside only when there is an actual unmarked path, rather
          // than abandoning width merely because a central shot would
          // look attractive if defenders were ignored.
          if (nearestOpponent(point, opponents) < 5.6 ||
              laneObstruction(reference, point, opponents) > 1.3)
            continue
          const chance = attackingOpportunityAt(
            point, team, setup, opponents)
          const scored = supportOpportunity(player, point, base, anchor,
            reference, opponents, teammates, reserved,
            team.attackingDirection, chance * 1.4)
          if (scored) considered.push(scored)
        }
      }
    }
    if (combination && player.playerId === combination.playerId) {
      const scored = supportOpportunity(player, combination.target,
        base, anchor, reference, opponents, teammates, reserved,
        team.attackingDirection, combination.utilityBonus)
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
