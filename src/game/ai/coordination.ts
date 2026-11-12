import type { MatchSetup } from '../model/match'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type { BallMatchState, PlayerMatchState } from '../match/state'
import {
  AIR_DRAG_PER_M, BALL_RADIUS_M, GRAVITY_MPS2,
  ROLLING_DECELERATION_MPS2,
} from '../physics/ball'
import { deriveMotionLimits } from '../physics/locomotion'
import { FOOT_CONTACT_MAX_HEIGHT_M, FOOT_REACH_M } from '../physics/contact'

/**
 * Deterministic tactical geometry. All values are initial design estimates.
 * Targets are intentions only; locomotion/contact decide what really occurs.
 */
export const COORDINATION_VERSION = 'predictive-off-ball-v1'
export const MAX_INTERCEPTION_HORIZON_S = 3.2
const SAMPLE_INTERVAL_S = 0.1
const MARGIN_M = 2.5
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const separationM = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)

export function boundedTarget(point: Point2, pitch: PitchDefinition): Point2 {
  return {
    xM: clamp(point.xM, MARGIN_M, pitch.lengthM - MARGIN_M),
    yM: clamp(point.yM, MARGIN_M, pitch.widthM - MARGIN_M),
  }
}

/** Ground ball prediction uses the exact Phase-2 deceleration equation.
 * Aerial prediction is a modest ballistic approximation (no bounce prediction).
 */
export function predictBallAt(
  ball: BallMatchState, tSeconds: number,
): { readonly position: Point2; readonly heightM: number } {
  const t = Math.max(0, Math.min(MAX_INTERCEPTION_HORIZON_S,
    Number.isFinite(tSeconds) ? tSeconds : 0))
  const vx = ball.velocity.xMps
  const vy = ball.velocity.yMps
  const speed = Math.hypot(vx, vy)
  const ground = ball.heightM <= BALL_RADIUS_M + 1e-8 &&
    ball.velocity.zMps <= 0
  if (speed < 1e-10) return {
    position: { ...ball.position },
    heightM: ground ? BALL_RADIUS_M :
      Math.max(BALL_RADIUS_M,
        ball.heightM + ball.velocity.zMps * t - .5 * GRAVITY_MPS2 * t * t),
  }
  let factor: number
  if (ground) {
    const movingTime = Math.min(t, speed / ROLLING_DECELERATION_MPS2)
    factor = (speed * movingTime -
      .5 * ROLLING_DECELERATION_MPS2 * movingTime * movingTime) / speed
  } else {
    factor = Math.log1p(AIR_DRAG_PER_M * speed * t) /
      (AIR_DRAG_PER_M * speed)
  }
  return {
    position: {
      xM: ball.position.xM + vx * factor,
      yM: ball.position.yM + vy * factor,
    },
    heightM: ground ? BALL_RADIUS_M :
      Math.max(BALL_RADIUS_M,
        ball.heightM + ball.velocity.zMps * t - .5 * GRAVITY_MPS2 * t * t),
  }
}

export interface InterceptionEstimate {
  readonly target: Point2
  readonly etaSeconds: number
  readonly separationM: number
}

/** Time to reach projected ball position given acceleration/speed/reach.
 * Orientation and collisions remain with authoritative locomotion physics.
 * Estimates determine the *target*, not possession or contact success.
 */
export function estimateInterception(
  player: PlayerMatchState, definition: PlayerDefinition,
  ball: BallMatchState, pitch: PitchDefinition,
): InterceptionEstimate | null {
  if (ball.outsidePitch) return null
  const limits = deriveMotionLimits(definition, player.energy)
  const timeToSpeed = limits.maxSpeedMps / limits.accelerationMps2
  for (let step = 1; step <= MAX_INTERCEPTION_HORIZON_S / SAMPLE_INTERVAL_S; step += 1) {
    const t = step * SAMPLE_INTERVAL_S
    const sample = predictBallAt(ball, t)
    if (sample.heightM > FOOT_CONTACT_MAX_HEIGHT_M ||
        sample.position.xM < 0 || sample.position.xM > pitch.lengthM ||
        sample.position.yM < 0 || sample.position.yM > pitch.widthM) continue
    const acceleratingTime = Math.min(t, timeToSpeed)
    const maximumTravel = .5 * limits.accelerationMps2 *
      acceleratingTime * acceleratingTime +
      limits.maxSpeedMps * Math.max(0, t - timeToSpeed) +
      Math.min(1.1, Math.hypot(
        player.velocity.xMps, player.velocity.yMps) * t * .35)
    const separation = separationM(player.position, sample.position)
    if (separation <= maximumTravel + FOOT_REACH_M * .88) {
      return {
        target: boundedTarget(sample.position, pitch),
        etaSeconds: t,
        separationM: separation,
      }
    }
  }
  return null
}

/** Sort by physical interception opportunity instead of raw distance to
 * current ball coordinates. On impossible intercepts, closest recovery wins.
 */
export function rankBallChasers(
  players: readonly PlayerMatchState[], definitions: ReadonlyMap<string, PlayerDefinition>,
  ball: BallMatchState, pitch: PitchDefinition, excludedId: string | null = null,
): PlayerMatchState[] {
  const candidates = players.filter(p =>
    p.formationSlot !== 'GK' && p.playerId !== excludedId)
  const scored = candidates.map(p => {
    const definition = definitions.get(p.playerId)
    if (!definition) throw new Error('Missing player definition in ball pursuit')
    const estimate = estimateInterception(p, definition, ball, pitch)
    const base = estimate
      ? estimate.etaSeconds
      : 5 + separationM(p.position, ball.position) /
        Math.max(1, deriveMotionLimits(definition, p.energy).maxSpeedMps)
    const awareness = definition.abilities.mental.anticipation
    return { player: p, score: base - awareness * .0008, estimate }
  })
  scored.sort((a, b) => a.score - b.score ||
    (a.player.playerId < b.player.playerId ? -1 :
      a.player.playerId > b.player.playerId ? 1 : 0))
  return scored.map(s => s.player)
}

export function pursuitTarget(
  player: PlayerMatchState, definition: PlayerDefinition,
  ball: BallMatchState, pitch: PitchDefinition,
): Point2 {
  return estimateInterception(player, definition, ball, pitch)?.target ??
    boundedTarget(ball.position, pitch)
}

const anchored = (anchor: Point2, target: Point2, fraction: number): Point2 => ({
  xM: anchor.xM + (target.xM - anchor.xM) * fraction,
  yM: anchor.yM + (target.yM - anchor.yM) * fraction,
})

/** Coordinates the ball-side supporting lines with role and flank.
 * Two central midfielders offer opposed passing angles; the holding
 * midfielder offers an outlet behind; wide players remain outside.
 */
export function supportTarget(
  player: PlayerMatchState, anchor: Point2, reference: Point2,
  direction: 1 | -1, setup: MatchSetup,
): Point2 {
  const slot = player.formationSlot
  const { lengthM, widthM } = setup.pitch
  const side = slot === 'RCM' || slot === 'RW' || slot === 'RB' ? 1 :
    slot === 'LCM' || slot === 'LW' || slot === 'LB' ? -1 :
    anchor.yM >= widthM / 2 ? 1 : -1
  let point: Point2
  if (slot === 'RCM' || slot === 'LCM') {
    const xStep = slot === 'RCM' ? -5.0 : 5.0
    point = {
      xM: reference.xM + xStep * direction,
      yM: reference.yM + side * 8.0,
    }
  } else if (slot === 'DM') {
    point = { xM: reference.xM - 12 * direction,
      yM: reference.yM + (anchor.yM - widthM / 2) * .35 }
  } else if (slot === 'RW' || slot === 'LW') {
    point = {
      xM: reference.xM + 11 * direction,
      yM: side > 0 ? widthM - 7.5 : 7.5,
    }
  } else if (slot === 'ST') {
    point = { xM: reference.xM + 11 * direction,
      yM: reference.yM + (anchor.yM - widthM / 2) * .1 }
  } else if (slot === 'RB' || slot === 'LB') {
    point = { xM: reference.xM - 16 * direction,
      yM: side > 0 ? widthM - 10 : 10 }
  } else if (slot === 'RCB' || slot === 'LCB') {
    point = { xM: reference.xM - 27 * direction,
      yM: anchor.yM + (reference.yM - widthM / 2) * .1 }
  } else {
    point = { ...anchor }
  }
  const weight = slot === 'GK' ? .18 :
    slot === 'RCB' || slot === 'LCB' ? .55 : .85
  const mixed = anchored(anchor, point, weight)
  return boundedTarget({
    xM: clamp(mixed.xM, 2.5, lengthM - 2.5),
    yM: mixed.yM,
  }, setup.pitch)
}

/** A second defender blocks the route toward goal while the first presses. */
export function coverTarget(
  defender: PlayerMatchState, pressing: PlayerMatchState,
  ballPoint: Point2, direction: 1 | -1, pitch: PitchDefinition,
): Point2 {
  const side = defender.position.yM <= pressing.position.yM ? -1 : 1
  const goalSide = -direction
  return boundedTarget({
    xM: ballPoint.xM + goalSide * 5.5,
    yM: ballPoint.yM + side * 4.8,
  }, pitch)
}

/** Mark only nearby potential receivers; keep a compact bounded displacement
 * from formation shape. This does not yet resolve body collisions or offside.
 */
export function markTarget(
  anchor: Point2, opponent: PlayerMatchState,
  direction: 1 | -1, pitch: PitchDefinition,
): Point2 {
  const desired = {
    xM: opponent.position.xM - direction * 2.8,
    yM: opponent.position.yM,
  }
  const shift = separationM(anchor, desired)
  const distanceLimit = 13
  const factor = shift > distanceLimit ? distanceLimit / shift : 1
  return boundedTarget({
    xM: anchor.xM + (desired.xM - anchor.xM) * factor,
    yM: anchor.yM + (desired.yM - anchor.yM) * factor,
  }, pitch)
}
