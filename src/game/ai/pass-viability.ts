import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type { BallMatchState, PlayerMatchState } from '../match/state'
import { BALL_RADIUS_M } from '../physics/ball'
import { deriveMotionLimits } from '../physics/locomotion'
import { contactAccuracy, kickAngleErrorRange } from '../physics/contact'
import { estimateInterception, predictBallAt } from './coordination'

/**
 * P6.9B: a pass is aimed for a physically reachable teammate, not a
 * cosmetic empty-space kick. This is a conservative tactical preview:
 * actual pass error, interceptions and control remain authoritative.
 */
export const PASS_CONNECTION_VERSION = 'reachable-physical-reception-v1'

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
  // Up to 1.6m displacement for momentum that cannot vanish instantly;
  // avoid leading a teammate all the way to an obsolete formation point.
  const coastDistance = Math.min(1.6, speed * speed / Math.max(2 * brakes, 1))
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
  const interception = estimateInterception(receiver, definition, trial, setup.pitch)
  const angleDiff = Math.atan2(Math.sin(heading - carrier.orientationRad),
    Math.cos(heading - carrier.orientationRad))
  const facing = Math.abs(angleDiff) / Math.PI
  const angleRange = kickAngleErrorRange(accuracy, facing, true, false)
  const uncertaintyM = d * Math.sin(angleRange)
  // Evaluate the exact nominal moving ball position when the receiver
  // might contact. A return value is not a forced control event.
  const atContact = interception
    ? predictBallAt(trial, interception.etaSeconds).position : target
  const outside = atContact.xM < 0 || atContact.xM > setup.pitch.lengthM ||
    atContact.yM < 0 || atContact.yM > setup.pitch.widthM
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
    canReceive: !!interception && !outside,
    etaSeconds: interception?.etaSeconds ?? null,
    intendedPoint: interception?.target ?? target,
    uncertaintyM, safetyPenalty,
  }
}
