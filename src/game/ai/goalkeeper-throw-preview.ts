import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { BallMatchState, PlayerMatchState } from '../match/state'
import { advanceBallPhysics } from '../physics/ball'
import { sweptFootContact } from '../physics/automatic-contact'
import { FOOT_REACH_M } from '../physics/contact'
import { goalkeeperThrowVelocity } from '../physics/goalkeeper-handling'
import { projectPlayerToward } from '../physics/locomotion'
import { boundedTarget, estimateInterception, predictBallAt } from './coordination'

/**
 * The goalkeeper's ball-launch physics must match the actual hand-throw
 * resolver. Centralize these measured-in-engine (not real-world) values
 * so the preview never assumes a kick or a magic pass completion.
 */
export const GK_THROW_REHEARSAL_MAX_TICKS = 72
const GK_THROW_TICK_SECONDS = .05

export interface GoalkeeperThrowPreview {
  /** A possible first-foot-control, not a guaranteed actual reception. */
  readonly canControl: boolean
  readonly receptionSeconds: number | null
  readonly opponentEtaSeconds: number | null
  /** Clearance of the receiver to the ball path at the earliest foot sweep. */
  readonly contactGapM: number | null
  readonly landingOutsidePitch: boolean
}

/**
 * Rehearse one IDEAL hand-throw trajectory and a receiver using the very
 * same 50ms unowned-ball physics, turning/acceleration and swept foot reach
 * as the authoritative match. Opponents are *not frozen*: their fastest
 * potential intercept is estimated against the moving ball trajectory.
 *
 * This intentionally does not copy possession, roll the seeded aiming
 * error, award a catch or update any player. Poor execution can still
 * miss, be intercepted, deflect or leave the pitch in actual play.
 */
export function previewPhysicalGoalkeeperThrow(
  ball: BallMatchState, receiver: PlayerMatchState,
  target: Point2, power: number, setup: MatchSetup,
  opponents: readonly PlayerMatchState[],
): GoalkeeperThrowPreview {
  const receiverDefinition = setup.players.find(p => p.id === receiver.playerId)
  if (!receiverDefinition) throw new Error('Missing goalkeeper throw receiver')
  const trial: BallMatchState = {
    ...ball, controllerId: null, controlOffset: null,
    velocity: goalkeeperThrowVelocity(ball.position, target, power),
    outsidePitch: false,
  }

  // The most dangerous opponent's plausible time to first intercept.
  // One bounded prediction per opponent, not one per physics tick.
  let opponentEtaSeconds: number | null = null
  for (const player of opponents) {
    if (player.formationSlot === 'GK') continue
    const definition = setup.players.find(p => p.id === player.playerId)
    if (!definition) throw new Error('Missing goalkeeper throw opponent')
    const estimated = estimateInterception(player, definition, trial, setup.pitch)
    if (estimated && (opponentEtaSeconds === null ||
        estimated.etaSeconds < opponentEtaSeconds)) {
      opponentEtaSeconds = estimated.etaSeconds
    }
  }

  let currentBall = trial
  let movingReceiver = receiver
  let pursue = boundedTarget(target, setup.pitch)
  for (let tick = 1; tick <= GK_THROW_REHEARSAL_MAX_TICKS; tick += 1) {
    if (tick === 1 || tick % 4 === 0) {
      const predicted = estimateInterception(
        movingReceiver, receiverDefinition, currentBall, setup.pitch)
      pursue = predicted?.target ?? boundedTarget(
        predictBallAt(currentBall, .55).position, setup.pitch)
    }
    const nextReceiver = projectPlayerToward(
      movingReceiver, receiverDefinition, pursue, setup.pitch, tick)
    const nextBall = advanceBallPhysics(currentBall, setup.pitch)
    const touch = sweptFootContact(
      movingReceiver, nextReceiver, currentBall, nextBall)
    if (touch) {
      const a = receiverDefinition.abilities
      const quality = .5 * a.technical.firstTouch +
        .3 * a.technical.technique +
        .2 * a.mental.anticipation
      const relativeSpeed = Math.hypot(
        currentBall.velocity.xMps - movingReceiver.velocity.xMps,
        currentBall.velocity.yMps - movingReceiver.velocity.yMps)
      const difficulty = 1.6 * relativeSpeed +
        9 * touch.distanceM / FOOT_REACH_M
      return {
        canControl: quality - difficulty >= 24,
        receptionSeconds: tick * GK_THROW_TICK_SECONDS,
        opponentEtaSeconds, contactGapM: touch.distanceM,
        landingOutsidePitch: nextBall.outsidePitch,
      }
    }
    if (nextBall.outsidePitch) return {
      canControl: false, receptionSeconds: null,
      opponentEtaSeconds, contactGapM: null,
      landingOutsidePitch: true,
    }
    movingReceiver = nextReceiver
    currentBall = nextBall
  }
  return {
    canControl: false, receptionSeconds: null,
    opponentEtaSeconds, contactGapM: null,
    landingOutsidePitch: currentBall.outsidePitch,
  }
}
