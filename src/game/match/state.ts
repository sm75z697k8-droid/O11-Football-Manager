import type { SimulationClock } from '../core/clock'
import type { RandomStreamCheckpoint } from '../core/rng'
import type { Point2 } from '../model/pitch'
import type { ClubId, PlayerId } from '../model/player'
import type { Formation433Slot, PlayerDuty, PlayerRole } from '../model/team'
import type { ScheduledMatchCommand, AppliedMatchCommand } from './commands'

export const MATCH_STATE_SCHEMA_VERSION = 4 as const
export const FOUNDATION_ENGINE_VERSION = 'o11-player-contact-p3-v1' as const

export const MATCH_RANDOM_STREAM_IDS = [
  'team/home/decisions', 'team/away/decisions',
  'ball/contact', 'match/referee', 'match/injuries',
] as const
export type MatchRandomStreamId = (typeof MATCH_RANDOM_STREAM_IDS)[number]
export type PressingIntensity = 'low' | 'standard' | 'high'
export interface Velocity2 { readonly xMps: number; readonly yMps: number }
export type PlayerIntention =
  | { readonly kind: 'holdFormation'; readonly sinceTick: number }
  | { readonly kind: 'moveToPoint'; readonly sinceTick: number; readonly target: Point2 }
export interface PlayerMatchState {
  readonly playerId: PlayerId
  readonly clubId: ClubId
  readonly shirtNumber: number
  readonly formationSlot: Formation433Slot
  readonly role: PlayerRole
  readonly duty: PlayerDuty
  readonly participation: 'onField'
  readonly position: Point2
  readonly velocity: Velocity2
  readonly orientationRad: number
  readonly energy: number
  readonly intention: PlayerIntention
}
export interface TeamMatchState {
  readonly clubId: ClubId
  readonly attackingDirection: 1 | -1
  readonly score: number
  readonly pressingIntensity: PressingIntensity
}
export interface BallMatchState {
  readonly position: Point2
  readonly heightM: number
  readonly velocity: Velocity2 & { readonly zMps: number }
  readonly outsidePitch: boolean
  /** Simplified foot-control constraint, not complete dribbling behavior. */
  readonly controllerId: PlayerId | null
  readonly controlOffset: Point2 | null
  readonly lastTouchPlayerId: PlayerId | null
}

export type ContactKind = 'control' | 'kick'
export type ContactOutcome =
  | 'controlled' | 'miscontrolled' | 'kicked'
  | 'outOfReach' | 'occupied' | 'alreadyControlled' | 'invalidDirection'
export interface ContactEvent {
  readonly commandId: string
  readonly playerId: PlayerId
  readonly tick: number
  readonly kind: ContactKind
  readonly outcome: ContactOutcome
  /** Whether this attempt consumed one random draw from ball/contact. */
  readonly drawUsed: 0 | 1
}

/** Headless diagnostics only; no tactical AI or playable football match. */
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
  readonly contactEvents: readonly ContactEvent[]
  readonly nextCommandSequence: number
}
