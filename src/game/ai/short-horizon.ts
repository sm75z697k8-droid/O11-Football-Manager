import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState } from '../match/state'
import type { PossessionChoice } from './possession'
import { attackingOpportunityAt } from './goal-directed'
import { deriveMotionLimits } from '../physics/locomotion'

/**
 * Phase 6.9A: bounded short-horizon evaluation, not branching match
 * simulations. No shot result, tackle, reception, or ball control is awarded.
 * Three geometric time samples per pass, 22 real player positions maximum.
 */
export const SHORT_HORIZON_PLANNER_VERSION = 'opportunity-risks-v1'
export const ON_BALL_HORIZON_SECONDS = 1.6
export const MAX_ON_BALL_CANDIDATES = 20
const clip = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x))
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)

export interface ActionAssessment {
  readonly choice: PossessionChoice
  /** Estimated utility on top of the existing positional planner. */
  readonly utility: number
  readonly horizonSeconds: number
  readonly reasons: readonly string[]
  /** A geometric risk estimate, NOT a percentage chance of interception. */
  readonly laneRisk: number
  readonly receivingRisk: number
}
export interface ShortHorizonReview {
  readonly assessments: readonly ActionAssessment[]
  readonly selectedReason: string
}

/** A cheap estimate of probable positions over the next 0–1.6s.
 * Existing player velocity and target direction matter; only real physics
 * moves these players. This model is intentionally not used for rendering.
 */
export function anticipatePlayer(
  player: PlayerMatchState, setup: MatchSetup, seconds: number,
): Point2 {
  const t = clip(seconds, 0, ON_BALL_HORIZON_SECONDS)
  const definition = setup.players.find(p => p.id === player.playerId)
  if (!definition) throw new Error('Missing definition for player anticipation')
  const maxSpeed = deriveMotionLimits(definition, player.energy).maxSpeedMps
  const currentSpeed = Math.hypot(player.velocity.xMps, player.velocity.yMps)
  let vx = player.velocity.xMps
  let vy = player.velocity.yMps
  if (player.intention.kind === 'moveToPoint') {
    const target = player.intention.target
    const dx = target.xM - player.position.xM
    const dy = target.yM - player.position.yM
    const len = Math.hypot(dx, dy)
    if (len > .25) {
      const targetSpeed = Math.min(maxSpeed, Math.sqrt(len * 6))
      const blend = clip(.25 + .24 * t, .25, .62)
      vx = (1 - blend) * vx + blend * dx / len * targetSpeed
      vy = (1 - blend) * vy + blend * dy / len * targetSpeed
    }
  }
  const speed = Math.hypot(vx, vy)
  const scale = speed > maxSpeed ? maxSpeed / speed : 1
  // Accelerating from rest cannot reach max speed instantly.
  const timeFactor = currentSpeed < .7 ? .55 : .78
  const move = t * scale * timeFactor
  return {
    xM: clip(player.position.xM + vx * move,
      0, setup.pitch.lengthM),
    yM: clip(player.position.yM + vy * move,
      0, setup.pitch.widthM),
  }
}

function nearby(position: Point2, opponents: readonly PlayerMatchState[],
  setup: MatchSetup, time: number): number {
  let closest = 100
  for (const p of opponents) {
    closest = Math.min(closest,
      distance(position, anticipatePlayer(p, setup, time)))
  }
  return closest
}

function targetAt(from: Point2, to: Point2, fraction: number): Point2 {
  return {
    xM: from.xM + (to.xM - from.xM) * fraction,
    yM: from.yM + (to.yM - from.yM) * fraction,
  }
}

/** Return the physical ball's approximate time to a passed target.
 * Exact airborne movement, rolling drag, and seeded contact remain with
 * physics; flight time is only a tactical planning approximation.
 */
function estimatedPassSeconds(choice: Extract<PossessionChoice, {kind:'pass'}>,
  from: Point2, carrier: PlayerMatchState,
  setup: MatchSetup): number {
  const player = setup.players.find(p => p.id === carrier.playerId)
  if (!player) throw new Error('Missing passer definition')
  const a = player.abilities
  const accuracy = (.5 * a.technical.passing +
    .3 * a.technical.technique + .2 * a.mental.composure) / 100
  const kickSpeed = 3 + choice.power *
    (14 + .13 * a.physical.strength + .065 * a.technical.technique) *
    (.9 + .1 * accuracy)
  const flight = distance(from, choice.target) /
    Math.max(3.5, kickSpeed - .8)
  return clip(flight, .25, ON_BALL_HORIZON_SECONDS)
}

function assessedPass(
  choice: Extract<PossessionChoice, {kind:'pass'}>,
  owner: PlayerMatchState, state: MatchState, setup: MatchSetup,
  opponents: readonly PlayerMatchState[],
): ActionAssessment {
  const receiver = state.players.find(p => p.playerId === choice.receiverId)
  if (!receiver) throw new Error('Missing real pass receiver')
  const team = state.teams.find(t => t.clubId === owner.clubId)
  if (!team) throw new Error('Missing attacking side')
  const flight = estimatedPassSeconds(choice, owner.position, owner, setup)
  const predictedReceiver = anticipatePlayer(receiver, setup, flight)
  const displacement = distance(choice.target, predictedReceiver)
  const receivingRisk = clip((displacement - 1.1) * 1.35, 0, 7)
  const opponentAtReceipt = nearby(choice.target, opponents, setup, flight)
  const pressureRisk = clip((4.2 - opponentAtReceipt) * 1.8, 0, 6)

  let interceptionRisk = 0
  // Check ball passage at several points rather than receiver distance only.
  for (const fraction of [.25, .55, .82]) {
    const point = targetAt(owner.position, choice.target, fraction)
    const sampleTime = flight * fraction
    let danger = 0
    for (const defender of opponents) {
      const projected = anticipatePlayer(defender, setup, sampleTime)
      const gap = distance(projected, point)
      const def = setup.players.find(p => p.id === defender.playerId)
      if (!def) throw new Error('Missing opponent definition')
      const reachable = 1.2 + deriveMotionLimits(def, defender.energy)
        .maxSpeedMps * sampleTime * .38
      danger = Math.max(danger, clip(
        (reachable - gap) / Math.max(1, reachable), 0, 1))
    }
    interceptionRisk += danger
  }
  const laneRisk = clip(interceptionRisk * 2, 0, 6)
  const oldChance = attackingOpportunityAt(
    owner.position, team, setup, opponents)
  const futureChance = attackingOpportunityAt(
    predictedReceiver, team, setup, opponents)
  // This is an incentive for real line-breaking movement, not arbitrary
  // extra utility for every safe sideways or backwards pass.
  const futureGain = clip((futureChance - oldChance) * .45, -3, 4)
  const penalty = laneRisk * 1.15 + pressureRisk + receivingRisk
  const utility = choice.utility - .6 - penalty + futureGain
  const reasons = [
    laneRisk > 2.2 ? 'Defender can contest the passing lane' :
      laneRisk > 0 ? 'Defender approaching the passing lane' :
        'Passing lane likely reachable',
    receivingRisk > 2 ? 'Receiver moving away from target' :
      'Receiver can meet the intended ball',
    pressureRisk > 1.8 ? 'Receiver likely under pressure' :
      'Receiver has some space',
    futureGain > 1.0 ? 'Pass may improve sight of goal' :
      futureGain < -1.0 ? 'Pass loses attacking opportunity' :
        'Maintains a viable possession option',
  ]
  return { choice, utility, horizonSeconds: flight,
    reasons, laneRisk, receivingRisk: pressureRisk + receivingRisk }
}

function assessedCarry(
  choice: Extract<PossessionChoice, {kind:'carry'}>,
  owner: PlayerMatchState, state: MatchState, setup: MatchSetup,
  opponents: readonly PlayerMatchState[],
): ActionAssessment {
  const def = setup.players.find(p => p.id === owner.playerId)!
  const team = state.teams.find(t => t.clubId === owner.clubId)!
  const maxSpeed = deriveMotionLimits(def, owner.energy).maxSpeedMps
  const span = distance(owner.position, choice.target)
  const horizon = clip(span / Math.max(maxSpeed * .7, 2), .35,
    ON_BALL_HORIZON_SECONDS)
  const fraction = span > 0 ? clip(maxSpeed * horizon * .65 / span, 0, 1) : 0
  const reached = targetAt(owner.position, choice.target, fraction)
  const middle = targetAt(owner.position, reached, .55)
  const firstGap = nearby(middle, opponents, setup, horizon * .55)
  const laterGap = nearby(reached, opponents, setup, horizon)
  const pressureRisk = clip((3.7 - Math.min(firstGap, laterGap)) * 1.9, 0, 6)
  const progress = (reached.xM - owner.position.xM) * team.attackingDirection
  const forwardAdvantage = progress > 1 && laterGap > 4.5
    ? clip(progress * .30, 0, 2.5) : 0
  const oldChance = attackingOpportunityAt(owner.position, team, setup, opponents)
  const laterChance = attackingOpportunityAt(reached, team, setup, opponents)
  const opportunity = clip((laterChance - oldChance) * .6, -2, 3.5)

  // Carry continuity avoids rapid, costly zig-zags after an unchanged
  // physical situation; a substantially better alternative still wins.
  const previous = state.ai.decisionSnapshot.find(d => d.playerId === owner.playerId)
  const continuing = previous?.action === 'carry' &&
    state.clock.tick > previous.tick &&
    state.clock.tick - previous.tick <= 24 &&
    owner.intention.kind === 'moveToPoint' &&
    distance(owner.intention.target, choice.target) < 2.4
  const continuity = continuing && pressureRisk < 3 ? 1.8 : 0
  const utility = choice.utility - pressureRisk +
    forwardAdvantage + opportunity + continuity
  const reasons = [
    pressureRisk > 2.2 ? 'Defender can challenge the dribble' :
      'Space available to carry',
    forwardAdvantage > 0 ? 'Advances into open territory' :
      'Protects current possession',
    opportunity > 1 ? 'Creates a better shooting position' :
      'Maintains current attacking position',
    ...(continuity ? ['Continues a sensible existing run'] : []),
  ]
  return { choice, utility, horizonSeconds: horizon,
    reasons, laneRisk: pressureRisk, receivingRisk: 0 }
}

function assessedShot(
  choice: Extract<PossessionChoice, {kind:'shoot'}>,
  owner: PlayerMatchState, _state: MatchState, setup: MatchSetup,
  opponents: readonly PlayerMatchState[],
): ActionAssessment {
  const from = owner.position
  const shotLine = choice.target
  const length = distance(from, shotLine)
  const flight = clip(length / 23, .2, ON_BALL_HORIZON_SECONDS)
  let laneRisk = 0
  for (const fraction of [.3, .6, .85]) {
    const sample = targetAt(from, shotLine, fraction)
    const nearest = nearby(sample,
      opponents.filter(p => p.formationSlot !== 'GK'),
      setup, flight * fraction)
    laneRisk += clip((2.4 - nearest) / 2.4, 0, 1)
  }
  laneRisk = clip(laneRisk * 1.8, 0, 5.4)
  const utility = choice.utility - laneRisk * 2
  return { choice, utility, horizonSeconds: flight,
    reasons: [
      laneRisk > 2 ? 'Defenders may block the shot' :
        'Shot has a usable corridor',
      'Finishing and goalkeeper still resolved physically',
    ],
    laneRisk, receivingRisk: 0 }
}

/** Pure diagnostics: caller may use these to explain a choice in the match
 * lab without copying tactical results into authoritative physics state.
 */
export function reviewOnBallActions(
  state: MatchState, setup: MatchSetup,
  options: readonly PossessionChoice[],
): ShortHorizonReview {
  const owner = state.players.find(p => p.playerId === state.ball.controllerId)
  if (!owner || !options.length) return {
    assessments: [], selectedReason: 'No controlled on-ball options',
  }
  if (options.length > MAX_ON_BALL_CANDIDATES) {
    throw new RangeError('Too many options for bounded on-ball review')
  }
  const opponents = state.players.filter(p => p.clubId !== owner.clubId)
  const assessments = options.map(choice =>
    choice.kind === 'pass'
      ? assessedPass(choice, owner, state, setup, opponents)
      : choice.kind === 'carry'
        ? assessedCarry(choice, owner, state, setup, opponents)
        : assessedShot(choice, owner, state, setup, opponents))
    .sort((a, b) => b.utility - a.utility ||
      (a.choice.kind < b.choice.kind ? -1 :
        a.choice.kind > b.choice.kind ? 1 : 0))
  return {
    assessments,
    selectedReason: assessments[0]?.reasons.join(' · ') ??
      'No available physical action',
  }
}
