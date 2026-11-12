import { FIXED_STEP_MILLISECONDS } from '../core/clock'
import type { PlayerDefinition } from '../model/player'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState } from '../match/state'

/**
 * Phase 1 individual locomotion, not football tactical AI.
 * Constants are estimated calibrations, not real-world measurements.
 * Units: metres, seconds, radians.
 */
export const PLAYER_PHYSICS_VERSION = 'player-locomotion-v1' as const
export const PLAYER_STEP_SECONDS = FIXED_STEP_MILLISECONDS / 1000

export interface MotionLimits {
  readonly maxSpeedMps: number
  readonly accelerationMps2: number
  readonly brakingMps2: number
  readonly turningRadps: number
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
export const wrapRadians = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle))

export function insidePitch(point: Point2, pitch: PitchDefinition): boolean {
  return !!point && Number.isFinite(point.xM) && Number.isFinite(point.yM) &&
    point.xM >= 0 && point.xM <= pitch.lengthM &&
    point.yM >= 0 && point.yM <= pitch.widthM
}

/** Physical attributes affect speed, acceleration, braking and turn radius. */
export function deriveMotionLimits(player: PlayerDefinition, energy = 100): MotionLimits {
  const a = player.abilities.physical
  const condition = 0.7 + 0.3 * clamp(energy, 0, 100) / 100
  return {
    maxSpeedMps: (4.5 + 0.044 * a.sprintSpeed) * condition,
    accelerationMps2: (2.4 + 0.045 * a.acceleration) * condition,
    brakingMps2: (3.2 + 0.045 * a.balance) * condition,
    turningRadps: (2.2 + 0.027 * a.agility + 0.010 * a.balance) * condition,
  }
}

function moveOne(
  p: PlayerMatchState, definition: PlayerDefinition, pitch: PitchDefinition, tick: number,
): PlayerMatchState {
  if (p.intention.kind !== 'moveToPoint') return p
  const target = p.intention.target
  const dx = target.xM - p.position.xM
  const dy = target.yM - p.position.yM
  const distance = Math.hypot(dx, dy)
  const limits = deriveMotionLimits(definition, p.energy)
  const speedBefore = Math.hypot(p.velocity.xMps, p.velocity.yMps)
  const dt = PLAYER_STEP_SECONDS

  // Only settle at the target once velocity is low enough to be braked
  // in one physics step; don't teleport from a full-speed sprint.
  if (distance <= 0.06 && speedBefore <= limits.brakingMps2 * dt) {
    return {
      ...p,
      position: { ...target },
      velocity: { xMps: 0, yMps: 0 },
      intention: { kind: 'holdFormation', sinceTick: tick },
    }
  }

  const desiredHeading = distance > 0 ? Math.atan2(dy, dx) : p.orientationRad
  const headingError = wrapRadians(desiredHeading - p.orientationRad)
  const turn = clamp(headingError, -limits.turningRadps * dt, limits.turningRadps * dt)
  const facing = wrapRadians(p.orientationRad + turn)
  const facingAlignment = Math.max(0, Math.cos(wrapRadians(desiredHeading - facing)))

  // Braking distance prevents full speed all the way to the target.
  const stoppingSpeed = Math.sqrt(2 * limits.brakingMps2 * Math.max(distance - 0.06, 0))
  const desiredSpeed = Math.min(limits.maxSpeedMps, stoppingSpeed) * facingAlignment
  const dvx = desiredSpeed * Math.cos(facing) - p.velocity.xMps
  const dvy = desiredSpeed * Math.sin(facing) - p.velocity.yMps
  const changeSize = Math.hypot(dvx, dvy)
  const rate = desiredSpeed < speedBefore ? limits.brakingMps2 : limits.accelerationMps2
  const fraction = changeSize > rate * dt ? rate * dt / changeSize : 1

  let vx = p.velocity.xMps + dvx * fraction
  let vy = p.velocity.yMps + dvy * fraction
  const newSpeed = Math.hypot(vx, vy)
  if (newSpeed > limits.maxSpeedMps) {
    vx *= limits.maxSpeedMps / newSpeed
    vy *= limits.maxSpeedMps / newSpeed
  }

  const proposedX = p.position.xM + vx * dt
  const proposedY = p.position.yM + vy * dt
  const xM = clamp(proposedX, 0, pitch.lengthM)
  const yM = clamp(proposedY, 0, pitch.widthM)
  // Boundary collision removes only the outward component of velocity.
  if (proposedX !== xM) vx = 0
  if (proposedY !== yM) vy = 0

  return { ...p, position: { xM, yM },
    velocity: { xMps: vx, yMps: vy }, orientationRad: facing }
}

/** Pure one-player preview using the identical acceleration, turning and
 * braking code as the authoritative match tick. Does NOT mutate a match.
 */
export function projectPlayerToward(
  player: PlayerMatchState, definition: PlayerDefinition,
  target: Point2, pitch: PitchDefinition, tick: number,
): PlayerMatchState {
  return moveOne({
    ...player,
    intention: { kind: 'moveToPoint', target, sinceTick: tick },
  }, definition, pitch, tick)
}

/** One authoritative fixed tick; idle matches allocate no player updates. */
export function advancePlayerLocomotion(
  state: MatchState, definitions: readonly PlayerDefinition[], pitch: PitchDefinition,
): MatchState {
  if (!state.players.some((p) => p.intention.kind === 'moveToPoint')) return state
  const lookup = new Map(definitions.map((p) => [p.id, p]))
  const players = state.players.map((p) => {
    if (p.intention.kind !== 'moveToPoint') return p
    const definition = lookup.get(p.playerId)
    if (!definition) throw new Error('Missing footballer for physical update: ' + p.playerId)
    return moveOne(p, definition, pitch, state.clock.tick)
  })
  return { ...state, players }
}
