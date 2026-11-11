import type { SimulationClock } from '../core/clock'
import type { RandomStreamCheckpoint } from '../core/rng'
import type { Point2 } from '../model/pitch'
import type { ClubId, PlayerId } from '../model/player'
import type { Formation433Slot, PlayerDuty, PlayerRole } from '../model/team'
import type { ScheduledMatchCommand, AppliedMatchCommand } from './commands'

export const MATCH_STATE_SCHEMA_VERSION = 1 as const
export const FOUNDATION_ENGINE_VERSION = 'o11-foundation-0d-v1' as const

/** Stable stream names; future decisions and ball contacts will consume these. */
export const MATCH_RANDOM_STREAM_IDS = [
  'team/home/decisions', 'team/away/decisions',
  'ball/contact', 'match/referee', 'match/injuries',
] as const

export type MatchRandomStreamId = (typeof MATCH_RANDOM_STREAM_IDS)[number]
export type PressingIntensity = 'low' | 'standard' | 'high'

export interface Velocity2 {
  readonly xMps: number
  readonly yMps: number
}

export interface PlayerMatchState {
  readonly playerId: PlayerId
  readonly clubId: ClubId
  readonly shirtNumber: number
  readonly formationSlot: Formation433Slot
  readonly role: PlayerRole
  readonly duty: PlayerDuty
  readonly participation: 'onField'
  /** Metres on the physical pitch, not pixels. */
  readonly position: Point2
  readonly velocity: Velocity2
  readonly orientationRad: number
  readonly energy: number
  /** Placeholder for later AI intentions, not a movement command. */
  readonly intention: { readonly kind: 'holdFormation'; readonly sinceTick: number }
}

export interface TeamMatchState {
  readonly clubId: ClubId
  readonly attackingDirection: 1 | -1
  readonly score: number
  /** Stored tactical preference only. No pressing behavior exists in Phase 0D. */
  readonly pressingIntensity: PressingIntensity
}

export interface BallMatchState {
  readonly position: Point2
  readonly heightM: number
  readonly velocity: Velocity2 & { readonly zMps: number }
  readonly controllerId: PlayerId | null
  readonly lastTouchPlayerId: PlayerId | null
}

/**
 * Fully authoritative Phase 0D diagnostic match state.
 * Period remains 'notStarted'; no football time, movement, scoring or AI
 * is simulated by the foundation engine.
 */
export interface MatchState {
  readonly schemaVersion: typeof MATCH_STATE_SCHEMA_VERSION
  readonly engineVersion: typeof FOUNDATION_ENGINE_VERSION
  readonly matchId: string
  readonly seed: number
  readonly clock: SimulationClock
  readonly period: 'notStarted'
  readonly teams: readonly [TeamMatchState, TeamMatchState]
  readonly players: readonly PlayerMatchState[]
  readonly ball: BallMatchState
  readonly randomStreams: Readonly<Record<MatchRandomStreamId, RandomStreamCheckpoint>>
  readonly pendingCommands: readonly ScheduledMatchCommand[]
  readonly appliedCommands: readonly AppliedMatchCommand[]
  /** One-based sequence number for the next accepted instruction. */
  readonly nextCommandSequence: number
}
