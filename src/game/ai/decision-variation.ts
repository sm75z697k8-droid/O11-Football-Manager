import { createRandomStream } from '../core/rng'

/**
 * Small, reproducible variation of NEAR-EQUAL on-ball utility scores.
 * We do not roll for a goal, a completed pass, or a chosen match result.
 * Candidate draws are keyed to match seed/player/tick/index, so the same
 * checkpoint and game state always produce precisely the same intention.
 * No wall time, Math.random, UI frame timing or hidden mutation is used.
 */
export const SEEDED_CHOICE_VERSION = 'bounded-player-judgment-v1'
export const MAX_VARIATION_UTILITY_GAP = 5.5

export interface RankedActionOption {
  readonly utility: number
}

/** Higher Decisions, Composure and Vision reduce option-selection noise,
 * but every player retains some individuality in close decisions.
 */
export function decisionDiscretion(
  decisions: number, composure: number, vision: number,
): number {
  const awareness = Math.max(0, Math.min(100,
    .55 * decisions + .30 * composure + .15 * vision))
  return 1.6 + (100 - awareness) * .035
}

/**
 * Stable substreams are independent of how often a planner recomputes a
 * snapshot. The index is its consistent candidate enumeration order.
 */
export function chooseSeededOption<T extends RankedActionOption>(
  options: readonly T[], matchSeed: number, playerId: string, tick: number,
  decisions: number, composure: number, vision: number,
  adjustment: (candidate: T) => number = () => 0,
): T | null {
  if (!options.length) return null
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError('Choice must use a nonnegative simulation tick')
  }
  const adjusted = options.map(o => o.utility + adjustment(o))
  const bestScore = Math.max(...adjusted)
  const spread = decisionDiscretion(decisions, composure, vision)
  let bestIndex = adjusted.indexOf(bestScore)
  let bestValue = -Infinity
  for (let index = 0; index < options.length; index++) {
    const gap = bestScore - adjusted[index]
    // Do not select a clearly inferior or obviously dangerous option.
    if (gap > MAX_VARIATION_UTILITY_GAP) continue
    const key = 'on-ball/' + playerId.slice(0, 48) + '/' + tick + '/' + index
    const roll = createRandomStream(matchSeed, key).nextFloat()
    const variability = 1 - gap / (MAX_VARIATION_UTILITY_GAP + 1)
    const value = adjusted[index] + (roll - .5) * 2 * spread * variability
    if (value > bestValue) {
      bestValue = value
      bestIndex = index
    }
  }
  return options[bestIndex]
}
