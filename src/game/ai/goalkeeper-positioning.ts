import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, predictBallAt } from './coordination'

/**
 * A goalkeeper's ordinary open-play position is a geometric decision, not
 * an automatic ball chase or a save animation. All displacement is carried
 * out by the existing player locomotion simulation.
 *
 * Distances below are estimated tactical calibrations in metres. They are
 * deliberately conservative: rushing out and one-on-ones remain separate
 * decisions, rather than being smuggled into general positioning.
 */
export const GOALKEEPER_POSITIONING_VERSION = 'open-play-angle-coverage-v1'

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n))

export interface GoalkeeperPositioningIntent {
  readonly target: Point2
  readonly engage: false
}

/** Compute the keeper's defensive depth and ball-to-goal angle on either side. */
export function planGoalkeeperPosition(
  state: MatchState, setup: MatchSetup,
  keeper: PlayerMatchState, team: TeamMatchState,
): GoalkeeperPositioningIntent | null {
  if (keeper.formationSlot !== 'GK' || keeper.clubId !== team.clubId ||
      state.ball.outsidePitch ||
      state.ball.controllerId === keeper.playerId) return null

  const definition = setup.players.find(p => p.id === keeper.playerId)
  const abilities = definition?.abilities
  const skills = abilities?.goalkeeping
  if (!abilities || !skills) return null

  const quality = clamp((
    skills.positioning * .55 +
    abilities.mental.anticipation * .25 +
    abilities.mental.decisions * .20
  ) / 100, 0, 1)
  const { lengthM, widthM, goalWidthM } = setup.pitch
  const direction = team.attackingDirection
  const goalX = direction === 1 ? 0 : lengthM
  const centreY = widthM / 2
  const controller = state.players.find(p =>
    p.playerId === state.ball.controllerId)
  const teammateInControl = controller?.clubId === team.clubId

  // A short look ahead helps with a loose ball rolling across the attack,
  // but never grants the keeper perfect knowledge of a future shot.
  const observed = state.ball.controllerId === null &&
    state.ball.heightM <= 1.5
    ? predictBallAt(state.ball, .12 + quality * .20).position
    : state.ball.position
  const depth = clamp(
    (observed.xM - goalX) * direction, 0, lengthM)

  // Remain closer to the line as danger approaches. Step up modestly when
  // the ball is safely away; this is NOT a sweeper keeper or 1v1 rush.
  let advance = depth < 7
    ? clamp(1.5 + depth * .19, 1.5, 2.83)
    : depth < 28
      ? 2.83 + (depth - 7) * .16
      : clamp(6.19 + (depth - 28) * .026, 6.19, 8.1)

  // Offer safe supporting depth with our team's foot possession without
  // blindly following a deep back-pass into its shooting lane.
  if (teammateInControl) {
    advance = clamp(4.1 + depth * .047, 4.1, 8.1)
  } else {
    // Less adept keepers tend to judge a slightly flatter depth. Small
    // attribute-driven errors are bounded, never scripted save failures.
    advance = clamp(advance - (1 - quality) * .55, 1.25, 8.1)
  }

  // Intersect the line from the ball to goal centre at the keeper's
  // intended depth. Wide, distant possession should NOT pull a keeper
  // all the way towards a post: that angle matters near the box.
  const interceptRatio = clamp(
    advance / Math.max(depth, advance + 1), 0, .82)
  const dangerWeight = clamp((64 - depth) / 45, .38, 1)
  const possessionWeight = teammateInControl ? .5 : 1
  const targetY = clamp(
    centreY + (observed.yM - centreY) * interceptRatio *
      dangerWeight * possessionWeight * (.80 + .20 * quality),
    centreY - goalWidthM / 2 - .8,
    centreY + goalWidthM / 2 + .8,
  )
  const target = boundedTarget({
    xM: goalX + direction * advance,
    yM: targetY,
  }, setup.pitch)

  // No sub-metre foot shuffling once the keeper is settled. This is a
  // position-intent deadband, not a teleport or a velocity override.
  const displacement = Math.hypot(
    target.xM - keeper.position.xM, target.yM - keeper.position.yM)
  const speed = Math.hypot(
    keeper.velocity.xMps, keeper.velocity.yMps)
  return {
    target: displacement < .4 && speed < .35
      ? { ...keeper.position } : target,
    engage: false,
  }
}
