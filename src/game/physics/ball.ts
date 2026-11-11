import { FIXED_STEP_MILLISECONDS } from '../core/clock'
import type { PitchDefinition } from '../model/pitch'
import type { BallMatchState } from '../match/state'

/**
 * Phase 2: deterministic unowned ball physics, no contact or football rules.
 * These constants are simulation ESTIMATES, not measured match telemetry.
 * All coordinates use metres, velocity m/s, time seconds.
 */
export const BALL_PHYSICS_VERSION = 'ball-motion-v1' as const
export const BALL_RADIUS_M = 0.11
export const GRAVITY_MPS2 = 9.81
export const ROLLING_DECELERATION_MPS2 = 0.75
export const AIR_DRAG_PER_M = 0.008
export const BOUNCE_RESTITUTION = 0.54
export const BOUNCE_HORIZONTAL_RETENTION = 0.84
export const MIN_BOUNCE_IMPACT_MPS = 0.85
export const MAX_LAUNCH_SPEED_MPS = 40
export const BALL_STEP_SECONDS = FIXED_STEP_MILLISECONDS / 1000

export interface BallVelocity {
  readonly xMps: number
  readonly yMps: number
  readonly zMps: number
}

const EPS = 1e-10

/** The WHOLE ball must cross a line; its centre may cross first. */
export function isBallFullyOutsidePitch(
  xM: number, yM: number, pitch: PitchDefinition,
): boolean {
  // Closest distance to the playing rectangle. Handles diagonal corner
  // exits correctly, where the sphere can be wholly outside two sidelines.
  const dx = Math.max(0, -xM, xM - pitch.lengthM)
  const dy = Math.max(0, -yM, yM - pitch.widthM)
  return dx * dx + dy * dy > BALL_RADIUS_M * BALL_RADIUS_M
}

export function validDiagnosticLaunchVelocity(input: unknown): input is BallVelocity {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  const v = input as Record<string, unknown>
  if (Object.keys(v).length !== 3 ||
      !['xMps', 'yMps', 'zMps'].every((k) => k in v)) return false
  const { xMps, yMps, zMps } = v
  if (typeof xMps !== 'number' || typeof yMps !== 'number' ||
      typeof zMps !== 'number' || !Number.isFinite(xMps) ||
      !Number.isFinite(yMps) || !Number.isFinite(zMps) || zMps < 0) return false
  const speed = Math.hypot(xMps, yMps, zMps)
  return speed > 0 && speed <= MAX_LAUNCH_SPEED_MPS
}

/** Purely diagnostic launch: sets velocity, without claiming a player kicked. */
export function launchDiagnosticBall(
  ball: BallMatchState, velocity: BallVelocity,
): BallMatchState {
  return {
    ...ball,
    velocity: {
      xMps: velocity.xMps, yMps: velocity.yMps, zMps: velocity.zMps,
    },
    controllerId: null,
    controlOffset: null,
    lastTouchPlayerId: null,
  }
}

function advanceGround(
  xM: number, yM: number, vx: number, vy: number, duration: number,
): { xM: number; yM: number; vx: number; vy: number } {
  const speed = Math.hypot(vx, vy)
  if (speed <= EPS) return { xM, yM, vx: 0, vy: 0 }
  const travelTime = Math.min(duration, speed / ROLLING_DECELERATION_MPS2)
  const distance = speed * travelTime -
    0.5 * ROLLING_DECELERATION_MPS2 * travelTime * travelTime
  const remain = Math.max(0, speed - ROLLING_DECELERATION_MPS2 * duration)
  const dx = vx / speed
  const dy = vy / speed
  return {
    xM: xM + dx * distance,
    yM: yM + dy * distance,
    vx: remain === 0 ? 0 : dx * remain,
    vy: remain === 0 ? 0 : dy * remain,
  }
}

/** Horizontally approximate quadratic aerodynamic drag; vertical flight
 * remains an analytic gravitational parabola (no spin or vertical drag yet).
 */
function advanceAirHorizontal(
  xM: number, yM: number, vx: number, vy: number, duration: number,
): { xM: number; yM: number; vx: number; vy: number } {
  const speed = Math.hypot(vx, vy)
  if (speed <= EPS) return { xM, yM, vx: 0, vy: 0 }
  const factor = 1 + AIR_DRAG_PER_M * speed * duration
  const distanceScale = Math.log(factor) / (AIR_DRAG_PER_M * speed)
  return {
    xM: xM + vx * distanceScale,
    yM: yM + vy * distanceScale,
    vx: vx / factor,
    vy: vy / factor,
  }
}

/**
 * Advance exactly one authoritative 50ms tick. Ground is radius-high;
 * contact with the turf causes an energy-losing rebound, not penetration.
 * No reflections at touchlines: crossing a line is not a solid wall.
 */
export function advanceBallPhysics(
  ball: BallMatchState, pitch: PitchDefinition,
): BallMatchState {
  if (ball.velocity.xMps === 0 && ball.velocity.yMps === 0 &&
      ball.velocity.zMps === 0 && ball.heightM === BALL_RADIUS_M) return ball

  let xM = ball.position.xM
  let yM = ball.position.yM
  let h = ball.heightM
  let vx = ball.velocity.xMps
  let vy = ball.velocity.yMps
  let vz = ball.velocity.zMps
  let remaining = BALL_STEP_SECONDS

  // Each collision consumes positive simulation time; micro-bounces eventually
  // terminate at the low-speed contact threshold.
  for (let collisions = 0; remaining > EPS && collisions < 10; collisions += 1) {
    if (h <= BALL_RADIUS_M + EPS && vz <= 0) {
      const ground = advanceGround(xM, yM, vx, vy, remaining)
      xM = ground.xM
      yM = ground.yM
      vx = ground.vx
      vy = ground.vy
      h = BALL_RADIUS_M
      vz = 0
      remaining = 0
      break
    }

    const aboveGround = Math.max(0, h - BALL_RADIUS_M)
    const impactTime = (vz + Math.sqrt(vz * vz + 2 * GRAVITY_MPS2 * aboveGround)) /
      GRAVITY_MPS2
    const travel = Math.min(remaining, impactTime)
    const air = advanceAirHorizontal(xM, yM, vx, vy, travel)
    xM = air.xM
    yM = air.yM
    vx = air.vx
    vy = air.vy
    h = Math.max(BALL_RADIUS_M, h + vz * travel -
      0.5 * GRAVITY_MPS2 * travel * travel)
    vz -= GRAVITY_MPS2 * travel
    remaining -= travel

    if (impactTime > travel + EPS) break // still airborne at end of tick
    h = BALL_RADIUS_M
    const impactSpeed = Math.max(0, -vz)
    vx *= BOUNCE_HORIZONTAL_RETENTION
    vy *= BOUNCE_HORIZONTAL_RETENTION
    if (impactSpeed < MIN_BOUNCE_IMPACT_MPS) {
      vz = 0
    } else {
      vz = impactSpeed * BOUNCE_RESTITUTION
    }
  }

  return {
    ...ball,
    position: { xM, yM },
    heightM: h,
    velocity: { xMps: vx, yMps: vy, zMps: vz },
    outsidePitch: isBallFullyOutsidePitch(xM, yM, pitch),
  }
}
