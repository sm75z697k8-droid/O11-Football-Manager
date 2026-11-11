import { describe, expect, it } from 'vitest'
import {
  advanceBallPhysics, BALL_RADIUS_M, BOUNCE_RESTITUTION,
  GRAVITY_MPS2, isBallFullyOutsidePitch, ROLLING_DECELERATION_MPS2,
  MAX_LAUNCH_SPEED_MPS, validDiagnosticLaunchVelocity,
} from '../../src/game/physics/ball'
import type { BallMatchState } from '../../src/game/match/state'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'

const still = (): BallMatchState => ({
  position: { xM: 52.5, yM: 34 },
  heightM: BALL_RADIUS_M,
  velocity: { xMps: 0, yMps: 0, zMps: 0 },
  outsidePitch: false,
  controllerId: null,
  lastTouchPlayerId: null,
})
const run = (ball: BallMatchState, steps: number): BallMatchState => {
  let result = ball
  for (let i = 0; i < steps; i += 1) result = advanceBallPhysics(result, DEFAULT_PITCH)
  return result
}
describe('Phase 2 deterministic ball physics', () => {
  it('keeps an unlaunched ball completely stationary without allocation', () => {
    const ball = still()
    expect(advanceBallPhysics(ball, DEFAULT_PITCH)).toBe(ball)
    expect(run(ball, 10_000)).toEqual(ball)
  })

  it('rolls under friction, slowing and stopping without reversing direction', () => {
    let ball: BallMatchState = { ...still(), velocity: { xMps: 5, yMps: 0, zMps: 0 } }
    let lastX = ball.position.xM
    let lastSpeed = ball.velocity.xMps
    for (let i = 0; i < 200; i += 1) {
      ball = advanceBallPhysics(ball, DEFAULT_PITCH)
      expect(ball.position.xM).toBeGreaterThanOrEqual(lastX)
      expect(ball.velocity.xMps).toBeGreaterThanOrEqual(0)
      expect(ball.velocity.xMps).toBeLessThanOrEqual(lastSpeed)
      expect(ball.heightM).toBe(BALL_RADIUS_M)
      lastX = ball.position.xM
      lastSpeed = ball.velocity.xMps
    }
    expect(ball.velocity.xMps).toBe(0)
    expect(ball.position.xM).toBeCloseTo(52.5 + 25 / (2 * ROLLING_DECELERATION_MPS2), 5)
    expect(advanceBallPhysics(ball, DEFAULT_PITCH)).toBe(ball)
  })

  it('uses gravity to produce a real airborne arc with horizontal drag', () => {
    const initial: BallMatchState = {
      ...still(), velocity: { xMps: 20, yMps: 0, zMps: 10 },
    }
    const next = run(initial, 1)
    expect(next.heightM).toBeCloseTo(
      BALL_RADIUS_M + 10 * 0.05 - 0.5 * GRAVITY_MPS2 * 0.05 ** 2, 9,
    )
    expect(next.velocity.zMps).toBeCloseTo(10 - GRAVITY_MPS2 * 0.05, 9)
    expect(next.position.xM).toBeGreaterThan(initial.position.xM)
    expect(next.velocity.xMps).toBeLessThan(20)
    const later = run(initial, 15)
    expect(later.heightM).toBeGreaterThan(next.heightM)
  })

  it('loses vertical energy on ground impact and cannot pass through turf', () => {
    let ball: BallMatchState = {
      ...still(), velocity: { xMps: 3, yMps: 0, zMps: 6 },
    }
    let lastVz = ball.velocity.zMps
    let rebound = false
    for (let i = 0; i < 160; i += 1) {
      ball = advanceBallPhysics(ball, DEFAULT_PITCH)
      expect(ball.heightM).toBeGreaterThanOrEqual(BALL_RADIUS_M)
      expect(Number.isFinite(ball.heightM)).toBe(true)
      if (lastVz < 0 && ball.velocity.zMps > 0) {
        rebound = true
        expect(ball.velocity.zMps).toBeLessThan(6 * BOUNCE_RESTITUTION + 1e-7)
      }
      lastVz = ball.velocity.zMps
    }
    expect(rebound).toBe(true)
    expect(ball.heightM).toBe(BALL_RADIUS_M)
    expect(ball.velocity.zMps).toBe(0)
  })

  it('marks the entire ball as outside only after it fully crosses the line', () => {
    expect(isBallFullyOutsidePitch(105 + BALL_RADIUS_M * 0.5, 34, DEFAULT_PITCH)).toBe(false)
    expect(isBallFullyOutsidePitch(105 + BALL_RADIUS_M * 1.1, 34, DEFAULT_PITCH)).toBe(true)
    expect(isBallFullyOutsidePitch(-BALL_RADIUS_M * 1.1, 34, DEFAULT_PITCH)).toBe(true)
    expect(isBallFullyOutsidePitch(52, 68 + BALL_RADIUS_M * 1.1, DEFAULT_PITCH)).toBe(true)
    // Diagonal corner crossings must account for the circular footprint.
    expect(isBallFullyOutsidePitch(-0.08, -0.08, DEFAULT_PITCH)).toBe(true)
    expect(isBallFullyOutsidePitch(-0.07, -0.07, DEFAULT_PITCH)).toBe(false)
  })

  it('never reflects off an imaginary touchline wall', () => {
    const initial: BallMatchState = {
      ...still(), position: { xM: 104, yM: 34 },
      velocity: { xMps: 10, yMps: 0, zMps: 0 },
    }
    const after = run(initial, 5)
    expect(after.position.xM).toBeGreaterThan(105 + BALL_RADIUS_M)
    expect(after.outsidePitch).toBe(true)
    expect(after.velocity.xMps).toBeGreaterThan(0)
  })

  it('allows an airborne ball to cross a boundary without inventing a goal', () => {
    const initial: BallMatchState = {
      ...still(), position: { xM: 103, yM: 34 },
      velocity: { xMps: 16, yMps: 0, zMps: 7 },
    }
    const after = run(initial, 8)
    expect(after.outsidePitch).toBe(true)
    expect(after.position.xM).toBeGreaterThan(105)
    expect(after.heightM).toBeGreaterThan(BALL_RADIUS_M)
  })

  it('validates nonzero, finite, physically capped diagnostic ball speeds', () => {
    expect(MAX_LAUNCH_SPEED_MPS).toBe(40)
    expect(validDiagnosticLaunchVelocity({ xMps: 18, yMps: 2, zMps: 12 })).toBe(true)
    for (const velocity of [
      { xMps: 0, yMps: 0, zMps: 0 },
      { xMps: 41, yMps: 0, zMps: 0 },
      { xMps: 1, yMps: 1, zMps: -1 },
      { xMps: NaN, yMps: 0, zMps: 1 },
      { xMps: Infinity, yMps: 0, zMps: 1 },
      { xMps: 1, yMps: 0, zMps: 1, spin: 2 },
      null,
    ]) {
      expect(validDiagnosticLaunchVelocity(velocity)).toBe(false)
    }
  })

  it('is repeatable for identical inputs across thousands of logical ticks', () => {
    const ball: BallMatchState = {
      ...still(), velocity: { xMps: 14, yMps: 3.5, zMps: 9 },
    }
    expect(run(ball, 1000)).toEqual(run(ball, 1000))
    expect(run(ball, 1000).heightM).toBe(BALL_RADIUS_M)
  })
})
