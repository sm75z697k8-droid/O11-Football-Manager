import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  AgentDecision, MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { activeGoalkeeperCatch } from '../physics/goalkeeper-handling'
import { boundedTarget, separationM } from './coordination'

/**
 * Phase 6.9K: receiving shape while a GK PHYSICALLY holds the ball.
 * This is a tactical intention planner, never a second ball controller,
 * teleport, guaranteed pass, or artificial defensive interception.
 */
export const GOALKEEPER_POSSESSION_SHAPE_VERSION = 'held-ball-outlet-spacing-v1'
const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, n))

type Slot = PlayerMatchState['formationSlot']
const outletDepth: Readonly<Record<Slot, readonly [number, number]>> = {
  GK: [0, 0],
  RCB: [15, 25], LCB: [15, 25],
  RB: [23, 35], LB: [23, 35],
  DM: [29, 42],
  RCM: [37, 53], LCM: [37, 53],
  RW: [49, 72], LW: [49, 72],
  ST: [54, 76],
}
const buildOrder: Readonly<Record<Slot, number>> = {
  GK: -1,
  RCB: 0, LCB: 0,
  RB: 1, LB: 1,
  DM: 2,
  RCM: 3, LCM: 3,
  RW: 4, LW: 4,
  ST: 5,
}

function distanceFromSegment(point: Point2, from: Point2, to: Point2) {
  const dx = to.xM - from.xM
  const dy = to.yM - from.yM
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-9) return { gap: separationM(point, from), fraction: 0 }
  const fraction = clamp(
    ((point.xM - from.xM) * dx + (point.yM - from.yM) * dy) /
    lengthSquared, 0, 1)
  return {
    gap: Math.hypot(
      point.xM - from.xM - fraction * dx,
      point.yM - from.yM - fraction * dy),
    fraction,
  }
}

function nearestOpponent(point: Point2, opponents: readonly PlayerMatchState[]) {
  return opponents.reduce(
    (nearest, player) => Math.min(nearest, separationM(point, player.position)),
    100)
}

/** Keeper-to-outlet passing LANE, not a fake probability of completion.
 * A genuine throw still uses its own ball flight and contact physics.
 */
function lanePressure(
  keeper: Point2, target: Point2,
  opponents: readonly PlayerMatchState[],
) {
  let risk = 0
  for (const opponent of opponents) {
    const sample = distanceFromSegment(opponent.position, keeper, target)
    if (sample.fraction < .12 || sample.fraction > .93) continue
    risk += Math.max(0, 3.5 - sample.gap)
  }
  return risk
}

function outletTarget(
  player: PlayerMatchState, anchor: Point2, keeper: PlayerMatchState,
  team: TeamMatchState, setup: MatchSetup,
  opponents: readonly PlayerMatchState[], reserved: readonly Point2[],
): Point2 {
  const { lengthM, widthM } = setup.pitch
  const centreY = widthM / 2
  const direction = team.attackingDirection
  const [minimum, maximum] = outletDepth[player.formationSlot]
  const forwardFromKeeper =
    (anchor.xM - keeper.position.xM) * direction
  const desiredDepth = clamp(forwardFromKeeper, minimum, maximum)
  const baseline: Point2 = boundedTarget({
    xM: keeper.position.xM + direction * desiredDepth,
    yM: anchor.yM +
      clamp((keeper.position.yM - centreY) * .09, -2.2, 2.2) +
      (player.formationSlot === 'RCB' || player.formationSlot === 'LCB'
        ? Math.sign(anchor.yM - centreY) * 2 : 0),
  }, setup.pitch)
  let best = baseline
  let bestValue = -Infinity

  // Small local adjustments create a genuine diagonal outlet instead of
  // dragging every teammate toward the keeper. The baseline maintains
  // distinct roles, flanks, and a meaningful forward depth.
  for (const dx of [-1.5, 0, 2.5]) {
    for (const dy of [-3, 0, 3]) {
      const point = boundedTarget({
        xM: baseline.xM + direction * dx,
        yM: baseline.yM + dy,
      }, setup.pitch)
      const forward = (point.xM - keeper.position.xM) * direction
      if (forward < minimum - 2.5 ||
          forward > maximum + 3.5 ||
          separationM(point, keeper.position) < 12) continue
      // A defender must not accidentally swap flanks to find open space.
      if (player.formationSlot !== 'DM' && player.formationSlot !== 'ST' &&
          (anchor.yM - centreY) * (point.yM - centreY) <= 0) continue
      const opponentGap = nearestOpponent(point, opponents)
      const lane = lanePressure(keeper.position, point, opponents)
      const spacing = reserved.reduce(
        (penalty, reservedPoint) => penalty +
          Math.max(0, 9 - separationM(point, reservedPoint)) * 2.3, 0)
      const change = separationM(point, baseline)
      const travel = separationM(player.position, point)
      const value = Math.min(opponentGap, 11) * .65 -
        lane * 2.3 - spacing - change * .42 - travel * .015
      if (value > bestValue) {
        best = point
        bestValue = value
      }
    }
  }
  // On an unusual keeper position (or tiny test pitch), the formation
  // baseline still provides a safe, physically reachable movement intent.
  return bestValue === -Infinity ? baseline : best
}

/** Outfield opponents occupy a compact screening block; they do not
 * physically chase a keeper who has secured a hand catch.
 */
function oppositionBlock(
  player: PlayerMatchState, anchor: Point2, keeper: PlayerMatchState,
  team: TeamMatchState, setup: MatchSetup,
): Point2 {
  const widthCentre = setup.pitch.widthM / 2
  const lineShift = team.pressingIntensity === 'high' ? 3 :
    team.pressingIntensity === 'low' ? -2.5 : 0
  const keeperSideShift = clamp(
    (keeper.position.yM - widthCentre) * .09, -2.5, 2.5)
  return boundedTarget({
    xM: anchor.xM + team.attackingDirection * lineShift,
    yM: anchor.yM + keeperSideShift,
  }, setup.pitch)
}

function buildOut(
  state: MatchState, setup: MatchSetup,
  keeper: PlayerMatchState, team: TeamMatchState,
): ReadonlyMap<string, AgentDecision> {
  const teammates = state.players.filter(p => p.clubId === team.clubId)
  const opponents = state.players.filter(p => p.clubId !== team.clubId)
  const reserved: Point2[] = []
  const decisions = new Map<string, AgentDecision>()
  const ordered = teammates.filter(p => p.playerId !== keeper.playerId)
    .sort((a, b) =>
      buildOrder[a.formationSlot] - buildOrder[b.formationSlot] ||
      a.playerId.localeCompare(b.playerId))

  decisions.set(keeper.playerId, {
    playerId: keeper.playerId, clubId: team.clubId,
    tick: state.clock.tick, action: 'shape',
    target: { ...keeper.position }, engage: false,
  })
  for (const player of ordered) {
    const anchor = state.ai.formationPositions[player.playerId]
    if (!anchor) throw new Error('Missing formation anchor for keeper distribution')
    const target = outletTarget(
      player, anchor, keeper, team, setup, opponents, reserved)
    reserved.push(target)
    decisions.set(player.playerId, {
      playerId: player.playerId, clubId: team.clubId,
      tick: state.clock.tick, action: 'support', target, engage: false,
    })
  }
  return decisions
}

function defendDistribution(
  state: MatchState, setup: MatchSetup,
  keeper: PlayerMatchState, team: TeamMatchState,
): ReadonlyMap<string, AgentDecision> {
  const defenders = state.players.filter(p => p.clubId === team.clubId)
  const outlets = state.players.filter(p =>
    p.clubId === keeper.clubId &&
    (p.formationSlot === 'RCB' || p.formationSlot === 'LCB' ||
     p.formationSlot === 'RB' || p.formationSlot === 'LB' ||
     p.formationSlot === 'DM'))
  const decisions = new Map<string, AgentDecision>()
  for (const player of defenders) {
    const anchor = state.ai.formationPositions[player.playerId]
    if (!anchor) throw new Error('Missing defending anchor on keeper catch')
    decisions.set(player.playerId, {
      playerId: player.playerId, clubId: team.clubId,
      tick: state.clock.tick,
      action: player.formationSlot === 'GK' ? 'shape' : 'recover',
      target: oppositionBlock(player, anchor, keeper, team, setup),
      engage: false,
    })
  }

  // A high-pressing XI may screen two short outlets, standard one, low
  // pressing none. These players move towards the RECEIVERS, never the GK.
  const count = team.pressingIntensity === 'high' ? 2 :
    team.pressingIntensity === 'standard' ? 1 : 0
  const alreadyScreened = new Set<string>()
  const front = defenders.filter(p =>
    p.formationSlot === 'ST' || p.formationSlot === 'RW' ||
    p.formationSlot === 'LW')
    .sort((a, b) =>
      separationM(a.position, keeper.position) -
      separationM(b.position, keeper.position) ||
      a.playerId.localeCompare(b.playerId))
  let screening = 0
  for (const player of front) {
    if (screening >= count) break
    const baseline = decisions.get(player.playerId)!.target
    const candidate = outlets.map(receiver => {
      const point = boundedTarget({
        xM: receiver.position.xM - team.attackingDirection * 3.5,
        yM: receiver.position.yM,
      }, setup.pitch)
      return { receiver, point,
        distance: separationM(point, baseline) }
    }).filter(item => !alreadyScreened.has(item.receiver.playerId) &&
      item.distance < 13 &&
      separationM(item.point, keeper.position) > 12)
      .sort((a,b)=>a.distance-b.distance ||
        a.receiver.playerId.localeCompare(b.receiver.playerId))[0]
    if (!candidate) continue
    alreadyScreened.add(candidate.receiver.playerId)
    decisions.set(player.playerId, {
      playerId: player.playerId, clubId: team.clubId,
      tick: state.clock.tick, action: 'mark',
      target: candidate.point, engage: false,
    })
    screening += 1
  }
  return decisions
}

/** BOTH teams receive their own goalkeeper-held-ball tactical snapshot.
 * Only a real catch can activate it; after throw/parry/open play, normal
 * pressing and dynamic support automatically resume.
 */
export function planHeldGoalkeeperShape(
  state: MatchState, setup: MatchSetup, teamId: string,
): ReadonlyMap<string, AgentDecision> | null {
  const catchEvent = activeGoalkeeperCatch(state)
  if (!catchEvent || state.ball.outsidePitch) return null
  const keeper = state.players.find(p => p.playerId === catchEvent.playerId)
  const team = state.teams.find(t => t.clubId === teamId)
  if (!keeper || !team) return null
  return keeper.clubId === teamId
    ? buildOut(state, setup, keeper, team)
    : defendDistribution(state, setup, keeper, team)
}
