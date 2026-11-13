import type { PlayerDefinition } from '../model/player'
import { FIXED_STEP_MILLISECONDS } from '../core/clock'

/**
 * A compact physical proxy for a keeper's body, arms and eventual dive.
 *
 * This is an estimated reach envelope, not a teleported goalkeeper or a
 * success probability. The existing swept ball/player collision is still
 * required to establish a real save. Before reaction, only close body/hand
 * contacts count; the keeper gains extension gradually as time passes.
 */
export const GOALKEEPER_SAVE_MECHANICS_VERSION = 'reaction-and-physical-reach-p69q-v1'

export interface GoalkeeperSaveWindow {
  readonly reactionDelaySeconds: number
  readonly elapsedSeconds: number
  readonly reacted: boolean
  readonly reachM: number
  readonly maximumHeightM: number
}

const clamp = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x))

/**
 * Reflexes and anticipation change when an actual shot can be reacted to;
 * diving and aerial skill change how far the keeper can extend afterwards.
 * Full extension takes additional time and therefore cannot intercept a
 * point-blank shot merely by having a high Diving rating.
 */
export function goalkeeperSaveWindow(
  player: PlayerDefinition, currentTick: number, shotTick: number,
): GoalkeeperSaveWindow {
  const abilities = player.abilities
  const skills = abilities.goalkeeping
  if (!skills) throw new Error('Only an actual goalkeeper has a save window')
  const delay = clamp(
    .30 - .00125 * skills.reflexes -
      .00050 * abilities.mental.anticipation,
    .11, .30,
  )
  const elapsed = Math.max(0,
    (currentTick - shotTick) * FIXED_STEP_MILLISECONDS / 1000)
  const reacted = elapsed >= delay
  // 0.38s of arm extension/diving after recognizing the shot.
  const extension = clamp((elapsed - delay) / .38, 0, 1)
  return {
    reactionDelaySeconds: delay,
    elapsedSeconds: elapsed,
    reacted,
    reachM: .82 + extension * (.42 + .006 * skills.diving),
    maximumHeightM: 1.55 +
      extension * (.60 + .0035 * skills.crossClaiming),
  }
}

/** Catching from full stretch is harder than collecting a central shot.
 * This is a difficulty modifier, not an outcome roll.
 */
export function goalkeeperCatchStretchPenalty(
  contactDistanceM: number, contactHeightM: number,
  window: GoalkeeperSaveWindow,
): number {
  const stretchFraction = clamp(
    (contactDistanceM - .82) /
      Math.max(.01, window.reachM - .82),
    0, 1)
  return stretchFraction * 22 + Math.max(0, contactHeightM - 1.4) * 9
}
