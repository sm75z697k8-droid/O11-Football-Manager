import type { PlayerDefinition } from './player'
import type { ClubDefinition, TeamSheet } from './team'
import type { PitchDefinition } from './pitch'

export const MATCH_SETUP_VERSION = 1 as const

/**
 * Phase 0B only: immutable INITIAL match inputs.
 * PlayerState, BallState, MatchState, clock, command queue and engine behavior
 * belong to subsequent approved phases, and are not simulated here.
 */
export interface MatchSetup {
  readonly setupVersion: typeof MATCH_SETUP_VERSION
  readonly matchId: string
  /** Unsigned 32-bit seed; the RNG algorithm is introduced in Phase 0C. */
  readonly seed: number
  readonly pitch: PitchDefinition
  /** Order is home, away. */
  readonly clubs: readonly [ClubDefinition, ClubDefinition]
  /** Team sheets must follow the same home/away order as clubs. */
  readonly teams: readonly [TeamSheet, TeamSheet]
  /** Exactly 22 unique players for the initial exhibition fixture. */
  readonly players: readonly PlayerDefinition[]
  /** Optional opening-kickoff rules for the viewer fixture; legacy tests omit it. */
  readonly kickoff?: { readonly teamId: string }
}
