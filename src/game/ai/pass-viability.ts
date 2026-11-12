import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type { BallMatchState, PlayerMatchState } from '../match/state'
import { BALL_RADIUS_M, advanceBallPhysics } from '../physics/ball'
import { sweptFootContact } from '../physics/automatic-contact'
import { deriveMotionLimits, projectPlayerToward } from '../physics/locomotion'
import { contactAccuracy, kickAngleErrorRange } from '../physics/contact'
import {
  boundedTarget, estimateInterception, predictBallAt,
} from './coordination'

/**
 * P6.9B: a pass is aimed for a physically reachable teammate, not a
 * cosmetic empty-space kick. This is a conservative tactical preview:
 * actual pass error, interceptions and control remain authoritative.
 */
export const PASS_CONNECTION_VERSION = 'kinematic-reception-preview-v2'
export const PASS_REHEARSAL_MAX_TICKS = 60

export interface PassViability {
  readonly canReceive: boolean
  readonly etaSeconds: number | null
  readonly intendedPoint: Point2
  readonly uncertaintyM: number
  readonly safetyPenalty: number
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

/** Short passes usually go to feet. A moving receiver gets at most modest
 * velocity-based lead; we must not extrapolate their outdated support run
 * across the whole ball flight after assigning a receiving instruction.
 */
export function passMeetingPoint(
  receiver: PlayerMatchState, setup: MatchSetup,
): Point2 {
  const vx = receiver.velocity.xMps
  const vy = receiver.velocity.yMps
  const speed = Math.hypot(vx, vy)
  const definition = setup.players.find(p => p.id === receiver.playerId)
  if (!definition) throw new Error('Missing intended receiver definition')
  const brakes = deriveMotionLimits(definition, receiver.energy).brakingMps2
  // Up to 1.05m displacement for momentum that cannot vanish instantly;
  // avoid leading a teammate all the way to an obsolete formation point.
  const coastDistance = Math.min(1.05,
    speed * speed / Math.max(2 * brakes, 1) * .6)
  const leadX = speed > .01 ? vx / speed * coastDistance : 0
  const leadY = speed > .01 ? vy / speed * coastDistance : 0
  return {
    xM: clamp(receiver.position.xM + leadX, 3.1, setup.pitch.lengthM - 3.1),
    yM: clamp(receiver.position.yM + leadY, 3.1, setup.pitch.widthM - 3.1),
  }
}

export function previewPhysicalPass(
  carrier: PlayerMatchState, passer: PlayerDefinition,
  receiver: PlayerMatchState, target: Point2,
  power: number, lift: number, ball: BallMatchState, setup: MatchSetup,
): PassViability {
  const dx = target.xM - ball.position.xM
  const dy = target.yM - ball.position.yM
  const d = Math.hypot(dx, dy)
  if (d < .05) return {
    canReceive: false, etaSeconds: null, intendedPoint: target,
    uncertaintyM: 100, safetyPenalty: 100,
  }
  const accuracy = contactAccuracy(passer, false)
  const speed = Math.min(38,
    (3 + power * (14 + .13 * passer.abilities.physical.strength +
      .065 * passer.abilities.technical.technique)) * (.9 + .1 * accuracy))
  const z = .6 * lift
  const horizontal = speed * Math.sqrt(1 - z * z)
  const heading = Math.atan2(dy, dx)
  const trial: BallMatchState = {
    ...ball,
    position: { ...ball.position },
    heightM: BALL_RADIUS_M,
    velocity: {
      xMps: horizontal * Math.cos(heading),
      yMps: horizontal * Math.sin(heading),
      zMps: speed * z,
    },
    controllerId: null, controlOffset: null, outsidePitch: false,
  }
  const definition = setup.players.find(p => p.id === receiver.playerId)
  if (!definition) throw new Error('Missing receiving footballer definition')
  // Rehearse only the intended receiver and the nominal physical pass.
  // This uses exactly the real 50ms ball physics and individual locomotion
  // integrators. It cannot award a successful touch, change match RNG, or
  // assume a ball magically arrives at its designated receiver.
  let ballAt = trial
  let moving = receiver
  let meeting: Point2 | null = null
  let arrival: number | null = null
  let aimedPosition = boundedTarget(target, setup.pitch)
  for (let tick = 1; tick <= PASS_REHEARSAL_MAX_TICKS; tick++) {
    if (tick === 1 || tick % 4 === 0) {
      const feasible = estimateInterception(
        moving, definition, ballAt, setup.pitch)
      aimedPosition = feasible?.target ?? boundedTarget(
        predictBallAt(ballAt, .55).position, setup.pitch)
    }
    const nextPlayer = projectPlayerToward(
      moving, definition, aimedPosition, setup.pitch, tick)
    const nextBall = advanceBallPhysics(ballAt, setup.pitch)
    const contact = sweptFootContact(
      moving, nextPlayer, ballAt, nextBall)
    if (contact && contact.impact.xM >= 0 &&
        contact.impact.xM <= setup.pitch.lengthM &&
        contact.impact.yM >= 0 &&
        contact.impact.yM <= setup.pitch.widthM) {
      arrival = tick * .05
      meeting = contact.impact
      break
    }
    if (nextBall.outsidePitch) break
    moving = nextPlayer
    ballAt = nextBall
  }

  const angleDiff = Math.atan2(Math.sin(heading - carrier.orientationRad),
    Math.cos(heading - carrier.orientationRad))
  const facing = Math.abs(angleDiff) / Math.PI
  const angleRange = kickAngleErrorRange(accuracy, facing, true, false)
  const uncertaintyM = d * Math.sin(angleRange)
  const margin = Math.min(
    target.xM, setup.pitch.lengthM - target.xM,
    target.yM, setup.pitch.widthM - target.yM,
  )
  // Width and accuracy interact. A 20m pass toward the touchline has less
  // margin than a 10m pass to a centrally placed midfielder.
  const safetyPenalty = clamp(
    (5 + uncertaintyM * .7 - margin) * 1.35, 0, 11) +
    clamp((uncertaintyM - 1) * .9, 0, 3)
  return {
    canReceive: arrival !== null,
    etaSeconds: arrival,
    intendedPoint: meeting ?? target,
    uncertaintyM, safetyPenalty,
  }
}
