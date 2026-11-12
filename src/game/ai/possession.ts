import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type { MatchState, PlayerMatchState, TeamMatchState } from '../match/state'
import {
  attackingOpportunityAt, evaluateShootingOpportunity,
} from './goal-directed'
import { chooseSeededOption } from './decision-variation'

/**
 * Context-aware on-ball choices: estimate opportunities, NEVER match results.
 * This is a bounded, deterministic utility planner on the existing metric pitch.
 * All weights are uncalibrated game-design estimates, not learned probabilities.
 */
export const POSSESSION_PLANNER_VERSION = 'seeded-goal-directed-possession-v5'
export const AI_SAFE_EDGE_MARGIN_M = 3.1
export const AI_PASS_MIN_INTERVAL_TICKS = 12

const min = Math.min
const max = Math.max
const clamp = (n: number, a: number, b: number) => max(a, min(b, n))
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)

export type PossessionChoice =
  | { readonly kind: 'shoot'; readonly target: Point2;
      readonly power: number; readonly lift: number; readonly utility: number }
  | { readonly kind: 'carry'; readonly target: Point2; readonly utility: number }
  | { readonly kind: 'pass'; readonly target: Point2; readonly receiverId: string;
      readonly power: number; readonly lift: number; readonly utility: number }

/** Nearest separation from a defender to an actual line segment, not merely
 * the receiver's proximity. The parameter t locates the defender along it.
 */
export function segmentProximity(
  defender: Point2, start: Point2, end: Point2,
): { distanceM: number; fraction: number } {
  const dx = end.xM - start.xM
  const dy = end.yM - start.yM
  const lengthSquared = dx * dx + dy * dy
  const fraction = lengthSquared < 1e-8 ? 0 :
    clamp(((defender.xM - start.xM) * dx +
      (defender.yM - start.yM) * dy) / lengthSquared, 0, 1)
  return {
    distanceM: Math.hypot(start.xM + fraction * dx - defender.xM,
      start.yM + fraction * dy - defender.yM),
    fraction,
  }
}

function nearestOpponent(position: Point2, opponents: readonly PlayerMatchState[]): number {
  let nearest = 1000
  for (const p of opponents) nearest = min(nearest, distance(position, p.position))
  return nearest
}

function safePoint(position: Point2, setup: MatchSetup): Point2 {
  const { widthM, lengthM } = setup.pitch
  return {
    xM: clamp(position.xM, AI_SAFE_EDGE_MARGIN_M, lengthM - AI_SAFE_EDGE_MARGIN_M),
    yM: clamp(position.yM, AI_SAFE_EDGE_MARGIN_M, widthM - AI_SAFE_EDGE_MARGIN_M),
  }
}

/**
 * Estimate density along a potential carry or pass corridor.
 * Ignore the immediate foot-contact zone around the carrier and account for
 * multiple defenders. This has no effect on the physical ball's trajectory.
 */
export function laneObstruction(
  from: Point2, to: Point2, defenders: readonly PlayerMatchState[],
): number {
  let obstruction = 0
  for (const defender of defenders) {
    const sample = segmentProximity(defender.position, from, to)
    if (sample.fraction < .09 || sample.fraction > .96) continue
    obstruction += max(0, 3.1 - sample.distanceM) * 2.4
  }
  return obstruction
}

function carryCandidates(
  player: PlayerMatchState, opponents: readonly PlayerMatchState[],
  setup: MatchSetup, direction: 1 | -1, def: PlayerDefinition,
): PossessionChoice[] {
  const { xM, yM } = player.position
  const candidates: readonly [number, number][] = [
    [8 * direction, 0],
    [6 * direction, -5],
    [6 * direction, 5],
    [0, -7], [0, 7],
    [-4 * direction, -5], [-4 * direction, 5],
    [0, 0], // shielding/holding is a physical movement target, not a fake event
  ]
  const options: PossessionChoice[] = []
  const currentPressure = nearestOpponent(player.position, opponents)
  const control = (def.abilities.technical.dribbling +
    def.abilities.physical.agility +
    def.abilities.mental.composure) / 3

  for (const [dx, dy] of candidates) {
    const target = safePoint({ xM: xM + dx, yM: yM + dy }, setup)
    const progress = (target.xM - xM) * direction
    const separation = distance(player.position, target)
    const space = nearestOpponent(target, opponents)
    const danger = laneObstruction(player.position, target, opponents)
    const boundaryDistance = min(
      target.xM, setup.pitch.lengthM - target.xM,
      target.yM, setup.pitch.widthM - target.yM,
    )
    // Stop carriers trying to run THROUGH the goal line instead of using
    // a real shot; near the box, goalward movement is still valuable.
    const goalSpace = direction === 1 ?
      setup.pitch.lengthM - xM : xM
    const goallinePenalty = progress > .5 && goalSpace < 5
      ? (5 - goalSpace) * 3.5 : 0
    const pressurePenalty = max(0, 5 - space) * (2.1 - control / 120)
    const utility =
      8 + .86 * progress + 1.05 * min(space, 12) +
      .046 * control -
      .34 * separation - 1.3 * danger - pressurePenalty -
      max(0, 5 - boundaryDistance) * 1.3 -
      goallinePenalty -
      (currentPressure < 2.5 && progress > 0 ? 3.5 : 0)
    options.push({ kind: 'carry', target, utility })
  }
  return options
}

function passCandidates(
  carrier: PlayerMatchState,
  teammates: readonly PlayerMatchState[],
  opponents: readonly PlayerMatchState[],
  setup: MatchSetup, team: TeamMatchState, def: PlayerDefinition,
): PossessionChoice[] {
  const options: PossessionChoice[] = []
  const direction = team.attackingDirection
  const passing = def.abilities.technical.passing
  const vision = def.abilities.mental.vision
  const decisions = def.abilities.mental.decisions
  const composure = def.abilities.mental.composure
  for (const receiver of teammates) {
    if (receiver.playerId === carrier.playerId) continue
    // Even the goalkeeper may be a safe backwards outlet. This does not
    // imply that goalkeeper distribution intelligence is complete.
    const separation = distance(carrier.position, receiver.position)
    if (separation < 3 || separation > 39) continue
    const aimed = safePoint({
      xM: receiver.position.xM + clamp(receiver.velocity.xMps * .3, -1.5, 1.5),
      yM: receiver.position.yM + clamp(receiver.velocity.yMps * .3, -1.5, 1.5),
    }, setup)
    const progress = (aimed.xM - carrier.position.xM) * direction
    const receiverSpace = nearestOpponent(aimed, opponents)
    const obstruction = laneObstruction(carrier.position, aimed, opponents)
    const danger = max(0, 4.3 - receiverSpace) * 2.1
    const difficulty = max(0, separation - 18) * .32
    const widePressure = nearestOpponent(carrier.position, opponents)
    const runnerSpeed = Math.hypot(receiver.velocity.xMps, receiver.velocity.yMps)
    // Forward progress is valuable but cannot override a blocked passing
    // lane or a tightly marked receiver. Backwards outlets remain eligible.
    // A teammate offering an open, reachable passing lane is a meaningful
    // possession option even when the ball carrier can dribble forward.
    // Reward genuine geometry, never a mere "pass more often" toggle.
    const unobstructedOutlet = receiverSpace >= 5.2 &&
      obstruction < 1.2 && separation <= 29
    const safeOutletBonus = unobstructedOutlet
      ? 3.4 + min(2.5, (receiverSpace - 5.2) * .32) : 0
    // A teammate moving into the open lane is a stronger outlet than a
    // standing marker; however, sprinting away at speed is not magically
    // assumed to guarantee a completed pass.
    const receiverMovementBonus = unobstructedOutlet
      ? min(1.6, runnerSpeed * .28) : 0
    // Passing is useful when it improves the next footballer's ability to
    // attack the goal. Endless sideways/backward recycling while unpressed
    // must not outrank carrying into a shooting position.
    const previousChance = attackingOpportunityAt(
      carrier.position, team, setup, opponents)
    const newChance = attackingOpportunityAt(
      aimed, team, setup, opponents)
    const chanceCreation = clamp((newChance - previousChance) * 1.5, -14, 16)
    const distanceToGoalLine = direction === 1
      ? setup.pitch.lengthM - carrier.position.xM : carrier.position.xM
    const sterileRecyclePenalty = distanceToGoalLine < 39 &&
      progress < 3 && widePressure > 5 ? 12 : 0
    const pressureReleaseBonus = widePressure < 8
      ? (8 - widePressure) * .55 : 0
    // A back pass is reasonable under pressure but should not become the
    // permanent default when a forward or lateral opportunity is open.
    const veryDeepRecycle = progress < -18 ? (Math.abs(progress) - 18) * .24 : 0
    const utility =
      9 + .52 * progress + 1.35 * min(receiverSpace, 12) +
      .077 * passing + .055 * vision + .038 * decisions +
      .018 * composure -
      .13 * separation - obstruction * 2.7 - danger -
      difficulty - veryDeepRecycle +
      safeOutletBonus + receiverMovementBonus + pressureReleaseBonus +
      chanceCreation - sterileRecyclePenalty
    // Match the actual foot-contact kick speed equation. An old minimum
    // power of .17 severely overhit short ground passes; the receiver had
    // little time to meet the ball before it raced into empty space.
    const accuracy = (.5 * passing +
      .3 * def.abilities.technical.technique + .2 * composure) / 100
    const strikeFactor = 14 + .13 * def.abilities.physical.strength +
      .065 * def.abilities.technical.technique
    const flightTime = clamp(separation / 9, .8, 2.4)
    const desiredSpeed = separation / flightTime + .375 * flightTime
    const power = clamp(
      (desiredSpeed / (.9 + .1 * accuracy) - 3) / strikeFactor,
      .035, .96)
    const lift = obstruction > 3.5 && separation > 13 && passing > 64
      ? .20 : 0
    options.push({
      kind: 'pass', target: aimed, receiverId: receiver.playerId,
      power, lift, utility,
    })
  }
  return options
}

function choiceKey(choice: PossessionChoice): string {
  if (choice.kind === 'shoot') return 'shoot:' + choice.target.yM.toFixed(2)
  if (choice.kind === 'pass') return 'pass:' + choice.receiverId
  return 'carry:' + choice.target.xM.toFixed(3) + ',' + choice.target.yM.toFixed(3)
}

/** The default pure evaluator preserves strict best-utility comparison for
 * tools and older tactical tests. Autonomous match decisions explicitly turn
 * on bounded, seed-derived choice variation within near-equal options.
 */
export function evaluateOnBallChoice(
  state: MatchState, setup: MatchSetup, allowPass = true,
  seededVariation = false,
): PossessionChoice | null {
  if (state.ball.outsidePitch || state.kickoff?.phase === 'awaitingKick') return null
  const owner = state.players.find(p => p.playerId === state.ball.controllerId)
  if (!owner) return null
  const team = state.teams.find(t => t.clubId === owner.clubId)
  const definition = setup.players.find(p => p.id === owner.playerId)
  if (!team || !definition) return null
  const teammates = state.players.filter(p => p.clubId === owner.clubId)
  const opponents = state.players.filter(p => p.clubId !== owner.clubId)
  const carrying = carryCandidates(owner, opponents,
    setup, team.attackingDirection, definition)
  const currentChance = attackingOpportunityAt(
    owner.position, team, setup, opponents)
  const options: PossessionChoice[] = carrying.map(choice => ({
    ...choice,
    // Dribbling is valuable if it materially improves sight of goal.
    utility: choice.utility + clamp((
      attackingOpportunityAt(choice.target, team, setup, opponents) -
      currentChance) * .95, -4, 13),
  }))
  if (allowPass) {
    options.push(...passCandidates(owner, teammates, opponents,
      setup, team, definition))
  }
  const shot = evaluateShootingOpportunity(owner, definition, opponents, team, setup)
  if (shot) options.push({
    kind: 'shoot', target: shot.target,
    power: shot.power, lift: shot.lift, utility: shot.utility,
  })
  // A shot must beat alternative opportunity utilities, not fire blindly.
  // A routine lateral pass gets no automatic positive bonus.
  const adjustment = -0.6
  options.sort((a, b) => {
    const adjusted = (v: PossessionChoice) => v.utility +
      (v.kind === 'pass' ? adjustment : 0)
    return adjusted(b) - adjusted(a) ||
      (choiceKey(a) < choiceKey(b) ? -1 : choiceKey(a) > choiceKey(b) ? 1 : 0)
  })
  if (!seededVariation) return options[0] ?? null
  const mental = definition.abilities.mental
  return chooseSeededOption(
    options, state.seed, owner.playerId, state.clock.tick,
    mental.decisions, mental.composure, mental.vision,
    candidate => candidate.kind === 'pass' ? adjustment : 0,
  )
}
