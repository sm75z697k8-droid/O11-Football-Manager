import type { SimulationClock } from '../core/clock'
import type { RandomStreamCheckpoint } from '../core/rng'
import type { Point2 } from '../model/pitch'
import type { ClubId, PlayerId } from '../model/player'
import type { Formation433Slot, PlayerDuty, PlayerRole } from '../model/team'
import type { ScheduledMatchCommand, AppliedMatchCommand } from './commands'

export const MATCH_STATE_SCHEMA_VERSION = 16 as const
export const FOUNDATION_ENGINE_VERSION = 'o11-physical-fouls-s17-v1' as const
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
  readonly engagesBall: boolean
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
  readonly controllerId: PlayerId | null
  readonly controlOffset: Point2 | null
  readonly lastTouchPlayerId: PlayerId | null
}
export type ContactKind = 'control' | 'kick' | 'throw' | 'throwIn' | 'goalKick' | 'cornerKick'
export type ContactOutcome =
  | 'controlled' | 'miscontrolled' | 'kicked'
  | 'outOfReach' | 'occupied' | 'alreadyControlled' | 'invalidDirection'
  | 'thrown' | 'thrownIn' | 'goalKicked' | 'cornerKicked' | 'notReady' | 'secondTouch' | 'notHolding' | 'tooSoon'
export interface ContactEvent {
  readonly commandId: string
  readonly playerId: PlayerId
  readonly tick: number
  readonly kind: ContactKind
  readonly outcome: ContactOutcome
  readonly drawUsed: 0 | 1
}
export interface AutomaticContactEvent {
  readonly tick: number
  readonly playerId: PlayerId
  readonly kind: 'interception' | 'challenge' | 'header'
  readonly outcome: 'intercepted' | 'deflected' | 'wonChallenge' | 'heldOff' | 'caught' | 'parried' | 'punched' | 'headed' | 'glanced'
  readonly contactFraction: number
}
/** The opening state and physical release; no other football restarts yet. */
export interface KickoffState {
  readonly teamId: ClubId
  readonly kickerId: PlayerId
  readonly receiverId: PlayerId
  readonly phase: 'awaitingKick' | 'inPlay'
  readonly takenTick: number | null
}
/** After a real scored goal, the conceding team physically restarts at
 * centre. This does not mutate the opening kick-off record or goal history.
 */
export interface PostGoalKickoffState {
  readonly goalTick: number
  readonly teamId: ClubId
  readonly kickerId: PlayerId
  readonly receiverId: PlayerId
  readonly phase: 'staging' | 'awaitingMovement'
  readonly kickedTick: number | null
}
export type MatchPeriod = 'notStarted' | 'firstHalf' |
  'halfTime' | 'secondHalf' | 'fullTime'
export interface MatchPeriodTiming {
  readonly firstHalfStartTick: number | null
  readonly secondHalfStartTick: number | null
  readonly firstHalfLostTicks: number
  readonly secondHalfLostTicks: number
  readonly firstHalfAddedTicks: number | null
  readonly secondHalfAddedTicks: number | null
  readonly halfTimeTick: number | null
  readonly fullTimeTick: number | null
}
/** The second-half kickoff is independent of the opening kickoff and
 * of centre kickoffs following scored goals.
 */
export interface PeriodKickoffState {
  readonly startTick: number
  readonly teamId: ClubId
  readonly kickerId: PlayerId
  readonly receiverId: PlayerId
  readonly phase: 'staging' | 'awaitingMovement'
  readonly kickedTick: number | null
}
export type AgentAction = 'shape' | 'support' | 'press' | 'jockey' | 'pursue' | 'carry' | 'receive' | 'cover' | 'mark' | 'recover' | 'shoot' | 'save' | 'oneOnOne' | 'claimCross' | 'head'
export interface AgentDecision {
  readonly tick: number
  readonly playerId: PlayerId
  readonly clubId: ClubId
  readonly action: AgentAction
  readonly engage: boolean
  readonly target: Point2
}
/** A selected recipient and meeting point for ONE genuine physical pass.
 * This intention cannot itself generate ball contact or award possession.
 */
export interface CoordinatedPassIntent {
  readonly commandId: string
  readonly teamId: ClubId
  readonly passerId: PlayerId
  readonly receiverId: PlayerId
  readonly requestedTick: number
  readonly target: Point2
}
/** A score can only arise from actual whole-ball goal-line crossing. */
export interface GoalEvent {
  readonly tick: number
  readonly side: 'left' | 'right'
  readonly scoringTeamId: ClubId
  readonly lastTouchPlayerId: PlayerId
  readonly ownGoal: boolean
  readonly crossingY: number
  readonly crossingHeightM: number
}
/** Each real crossing is logged exactly once; stage a legal restart only
 * after the WHOLE ball has left the field of play. */
export interface OutOfPlayEvent {
  readonly tick: number
  readonly kind: 'throwIn' | 'goalKick' | 'corner' | 'unassigned'
  readonly side: 'top' | 'bottom' | 'left' | 'right'
  readonly spot: Point2
  readonly lastTouchPlayerId: PlayerId | null
  readonly awardedTeamId: ClubId | null
  readonly takerId: PlayerId | null
}
/** Positions frozen at the instant an eligible teammate PHYSICALLY plays the ball.
 * Merely occupying an offside position is not an offence. */
export interface OffsidePhase {
  readonly playedTick: number
  readonly passerId: PlayerId
  readonly attackingTeamId: ClubId
  readonly playerIds: readonly PlayerId[]
}
export interface OffsideEvent {
  readonly tick: number
  readonly playedTick: number
  readonly passerId: PlayerId
  readonly offenderId: PlayerId
  readonly awardedTeamId: ClubId
  readonly takerId: PlayerId
  readonly spot: Point2
}
export interface IndirectFreeKick {
  readonly kickedTick: number
  readonly takerId: PlayerId
}
/** A confirmed real body-contact foul, not a random roll. All geometry
 * is in metres; the referee restart remains physical and auditable. */
export interface FoulEvent {
  readonly tick:number
  readonly offenderId:PlayerId
  readonly victimId:PlayerId
  readonly awardedTeamId:ClubId
  readonly kind:'directFreeKick'|'penalty'
  readonly spot:Point2
  readonly ballSpot:Point2
  readonly takerId:PlayerId
  readonly entryFraction:number
  readonly impactSpeedMps:number
  readonly riskScore:number
}
export interface AIState {
  readonly passIntent: CoordinatedPassIntent | null
  readonly enabledTeams: readonly [boolean, boolean]
  readonly lastDecisionTick: number
  readonly lastPassTick: number
  /** Bounded to the latest player decisions; not an infinite action log. */
  readonly decisionSnapshot: readonly AgentDecision[]
  /** Fixed from the validated starting setup, independent of player motion. */
  readonly formationPositions: Readonly<Record<PlayerId, Point2>>
}
/** Experimental goal event log; no full match period/referee/restarts yet. */
export interface MatchState {
  readonly schemaVersion: typeof MATCH_STATE_SCHEMA_VERSION
  readonly engineVersion: typeof FOUNDATION_ENGINE_VERSION
  readonly matchId: string
  readonly seed: number
  readonly clock: SimulationClock
  readonly period: MatchPeriod
  readonly periodTiming: MatchPeriodTiming
  readonly periodKickoff: PeriodKickoffState | null
  readonly kickoff: KickoffState | null
  readonly postGoalKickoff: PostGoalKickoffState | null
  readonly goalEvents: readonly GoalEvent[]
  readonly outOfPlayEvents: readonly OutOfPlayEvent[]
  readonly restart: OutOfPlayEvent | null
  readonly offsidePhase: OffsidePhase | null
  readonly offsideEvents: readonly OffsideEvent[]
  readonly offsideRestart: OffsideEvent | null
  readonly indirectFreeKick: IndirectFreeKick | null
  readonly foulEvents: readonly FoulEvent[]
  readonly foulRestart: FoulEvent | null
  readonly teams: readonly [TeamMatchState, TeamMatchState]
  readonly players: readonly PlayerMatchState[]
  readonly ball: BallMatchState
  readonly randomStreams: Readonly<Record<MatchRandomStreamId, RandomStreamCheckpoint>>
  readonly pendingCommands: readonly ScheduledMatchCommand[]
  readonly appliedCommands: readonly AppliedMatchCommand[]
  readonly contactEvents: readonly ContactEvent[]
  readonly automaticContactEvents: readonly AutomaticContactEvent[]
  readonly ballContactCooldownUntilTick: number
  readonly nextCommandSequence: number
  readonly ai: AIState
}
