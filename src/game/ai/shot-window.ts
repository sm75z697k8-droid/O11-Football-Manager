import type { PlayerDefinition } from '../model/player'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerMatchState, TeamMatchState, BallMatchState } from '../match/state'
import { BALL_RADIUS_M, advanceBallPhysics } from '../physics/ball'
import { contactAccuracy, kickAngleErrorRange } from '../physics/contact'

/**
 * Phase 6.9M: a small, deterministic geometric preview of the EXISTING
 * physical kick, including skill-dependent angle error and the actual 50ms
 * ball trajectory. This predicts only whether the ball might enter the
 * frame—not a goal, save, made shot, or preordained match result.
 */
export const SHOT_WINDOW_VERSION = 'physical-shot-window-p69m-v1'
const SHOT_PREVIEW_TICKS = 80
const SHOT_AIM_OFFSETS_M = [-2.3, 0, 2.3] as const
const SHOT_ERROR_SAMPLES = [-1, -.5, 0, .5, 1] as const
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))

export interface PhysicalShotWindow {
  readonly target: Point2
  /** Deterministic 5-point angle sample; NOT a calibrated percentage. */
  readonly onFrameShare: number
  /** Approximate geometric gap beyond the GK's short-horizon reach. */
  readonly keeperGap: number
  readonly value: number
}

interface Travel {
  readonly distanceM: number
  readonly heightM: number
  readonly seconds: number
}

/**
 * For a fixed launch speed/lift the ball model's drag and turf friction
 * are rotationally symmetric. Rehearse ONE radial trajectory with actual
 * ball physics and rotate its distance/height history for each candidate
 * shot bearing. This avoids 3 * 5 redundant per-tick physics rollouts on
 * iPhone Safari.
 */
function radialFlight(
  speed: number, lift: number, setup: MatchSetup,
): readonly Travel[] {
  const initial = { xM: setup.pitch.lengthM / 2,
    yM: setup.pitch.widthM / 2 }
  const rise = speed * .6 * lift
  const horizontal = speed * Math.sqrt(1 - (.6 * lift) ** 2)
  let ball: BallMatchState = {
    position: initial, heightM: BALL_RADIUS_M,
    velocity: { xMps: horizontal, yMps: 0, zMps: rise },
    outsidePitch: false, controllerId: null, controlOffset: null,
    lastTouchPlayerId: null,
  }
  const travelled: Travel[] = [{
    distanceM: 0, heightM: BALL_RADIUS_M, seconds: 0,
  }]
  for (let tick = 1; tick <= SHOT_PREVIEW_TICKS; tick += 1) {
    ball = advanceBallPhysics(ball, setup.pitch)
    travelled.push({
      distanceM: ball.position.xM - initial.xM,
      heightM: ball.heightM, seconds: tick * .05,
    })
    if (ball.outsidePitch || Math.abs(ball.velocity.xMps) < .03) break
  }
  return travelled
}

function interpolatedCrossing(
  steps: readonly Travel[], distance: number,
): {height: number; seconds: number} | null {
  for (let i = 1; i < steps.length; i += 1) {
    const previous = steps[i - 1]
    const next = steps[i]
    if (next.distanceM < distance) continue
    const fraction = clamp(
      (distance - previous.distanceM) /
        Math.max(1e-9, next.distanceM - previous.distanceM), 0, 1)
    return {
      height: previous.heightM +
        fraction * (next.heightM - previous.heightM),
      seconds: previous.seconds +
        fraction * (next.seconds - previous.seconds),
    }
  }
  return null
}

/**
 * This uses the same attribute weights, facing error, launch speed and
 * angular error envelope as actual `resolveContactAttempts`. No preview
 * call consumes RNG. Keeper coverage is a conservative *estimated* reach,
 * never an automatic save.
 */
export function evaluatePhysicalShotWindows(
  shooter: PlayerMatchState, definition: PlayerDefinition,
  opponents: readonly PlayerMatchState[],
  team: TeamMatchState, setup: MatchSetup,
  power: number, lift: number,
): readonly PhysicalShotWindow[] {
  const a = definition.abilities
  const accuracy = contactAccuracy(definition, true)
  const speed = Math.min(38,
    (3 + power * (14 + .13 * a.physical.strength +
      .065 * a.technical.technique)) * (.9 + .1 * accuracy))
  const trajectory = radialFlight(speed, lift, setup)
  const attackingGoalX = team.attackingDirection === 1
    ? setup.pitch.lengthM : 0
  const crossingX = attackingGoalX +
    team.attackingDirection * BALL_RADIUS_M
  const dx = crossingX - shooter.position.xM
  const centreY = setup.pitch.widthM / 2
  const allowedHalf = setup.pitch.goalWidthM / 2 - BALL_RADIUS_M
  const allowedHeight = setup.pitch.goalHeightM - BALL_RADIUS_M
  const keeper = opponents.find(p => p.formationSlot === 'GK')
  const keeperDefinition = keeper &&
    setup.players.find(p => p.id === keeper.playerId)
  const windows: PhysicalShotWindow[] = []

  for (const offset of SHOT_AIM_OFFSETS_M) {
    const target: Point2 = {
      xM: attackingGoalX, yM: centreY + offset,
    }
    const heading = Math.atan2(
      target.yM - shooter.position.yM,
      target.xM - shooter.position.xM)
    const facing = Math.abs(Math.atan2(
      Math.sin(heading - shooter.orientationRad),
      Math.cos(heading - shooter.orientationRad))) / Math.PI
    const errorRange = kickAngleErrorRange(accuracy, facing, false, true)
    let onFrame = 0
    let uncovered = 0
    for (const sample of SHOT_ERROR_SAMPLES) {
      const angle = heading + sample * errorRange
      const cos = Math.abs(Math.cos(angle))
      if (cos < .02) continue
      const crossingDistance = Math.abs(dx) / cos
      const cross = interpolatedCrossing(trajectory, crossingDistance)
      if (!cross) continue
      const crossingY = shooter.position.yM +
        Math.sin(angle) * crossingDistance
      const insideMouth = Math.abs(crossingY - centreY) <= allowedHalf &&
        cross.height <= allowedHeight &&
        cross.height >= BALL_RADIUS_M - 1e-7
      if (!insideMouth) continue
      onFrame += 1
      if (!keeper) {
        uncovered += 1
      } else {
        const reflexes = keeperDefinition?.abilities.goalkeeping?.reflexes ?? 50
        // Only part of the flight is usable reaction time. Not a second
        // goalkeeper physics engine or a guarantee of a save.
        const reactionSeconds = Math.max(
          0, cross.seconds - (.39 - reflexes * .0011))
        const lateralReachM = 1.05 +
          Math.min(1.25, reactionSeconds * .95)
        const gap = Math.abs(crossingY - keeper.position.yM)
        uncovered += clamp((gap - lateralReachM) / 2.4, 0, 1)
      }
    }
    const onFrameShare = onFrame / SHOT_ERROR_SAMPLES.length
    const keeperGap = uncovered / SHOT_ERROR_SAMPLES.length
    // Misses matter. A target too near a good goalkeeper matters too.
    // Scores are relative preferences, NOT probabilities of scoring.
    windows.push({
      target, onFrameShare, keeperGap,
      value: onFrameShare * .60 + keeperGap * .40,
    })
  }
  return windows.sort((a, b) =>
    b.value - a.value ||
    // Deterministic tie: keep the safer more central target when equal.
    Math.abs(a.target.yM - centreY) -
      Math.abs(b.target.yM - centreY) ||
    a.target.yM - b.target.yM)
}
