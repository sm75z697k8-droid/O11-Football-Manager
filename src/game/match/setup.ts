import { createSimulationClock } from '../core/clock'
import { createRandomStream } from '../core/rng'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { Formation433Slot } from '../model/team'
import { openingKickoffPosition, openingKickoffState } from './kickoff'
import { assertValidMatchSetup } from '../../data/validate'
import {
  FOUNDATION_ENGINE_VERSION, MATCH_RANDOM_STREAM_IDS, MATCH_STATE_SCHEMA_VERSION,
} from './state'
import type { MatchRandomStreamId, MatchState, PlayerMatchState, TeamMatchState } from './state'

/**
 * Normalized 4-3-3 starting positions (home team attacks toward +X).
 * These are STATIC diagnostic markers, not AI/physics outputs.
 */
const STARTING_POSITIONS: Readonly<Record<Formation433Slot, readonly [number, number]>> = {
  GK: [0.055, 0.5],
  RB: [0.235, 0.84], RCB: [0.20, 0.61],
  LCB: [0.20, 0.39], LB: [0.235, 0.16],
  DM: [0.36, 0.5],
  RCM: [0.45, 0.72], LCM: [0.45, 0.28],
  RW: [0.64, 0.86], ST: [0.73, 0.5], LW: [0.64, 0.14],
}

function startingPosition(
  slot: Formation433Slot, home: boolean,
  lengthM: number, widthM: number,
): Point2 {
  const [nx, ny] = STARTING_POSITIONS[slot]
  // Mirror both axes: away team's right flank remains its own right flank.
  return {
    xM: lengthM * (home ? nx : 1 - nx),
    yM: widthM * (home ? ny : 1 - ny),
  }
}

/** Validates then detaches the provided fixture from its external caller. */
export function createInitialMatchState(input: unknown): {
  setup: MatchSetup; state: MatchState
} {
  const fixture = structuredClone(assertValidMatchSetup(input))
  const teams: [TeamMatchState, TeamMatchState] = [
    { clubId: fixture.clubs[0].id, attackingDirection: 1, score: 0, pressingIntensity: 'standard' },
    { clubId: fixture.clubs[1].id, attackingDirection: -1, score: 0, pressingIntensity: 'standard' },
  ]
  const players: PlayerMatchState[] = fixture.teams.flatMap((team, teamIndex) =>
    team.starters.map((assignment) => ({
      playerId: assignment.playerId,
      clubId: team.clubId,
      shirtNumber: assignment.shirtNumber,
      formationSlot: assignment.slot,
      role: assignment.role,
      duty: assignment.duty,
      participation: 'onField' as const,
      position: openingKickoffPosition(
        fixture, teamIndex, assignment.slot,
        startingPosition(
          assignment.slot, teamIndex === 0,
          fixture.pitch.lengthM, fixture.pitch.widthM,
        ),
      ),
      velocity: { xMps: 0, yMps: 0 },
      orientationRad: teamIndex === 0 ? 0 : Math.PI,
      energy: 100,
      engagesBall: false,
      intention: { kind: 'holdFormation' as const, sinceTick: 0 },
    })),
  )
  const streams = Object.fromEntries(MATCH_RANDOM_STREAM_IDS.map((id) => [
    id, createRandomStream(fixture.seed, id).checkpoint(),
  ])) as Record<MatchRandomStreamId, ReturnType<ReturnType<typeof createRandomStream>['checkpoint']>>
  const state: MatchState = {
    schemaVersion: MATCH_STATE_SCHEMA_VERSION,
    engineVersion: FOUNDATION_ENGINE_VERSION,
    matchId: fixture.matchId,
    seed: fixture.seed,
    clock: createSimulationClock(),
    period: 'notStarted',
    kickoff: openingKickoffState(fixture),
    teams,
    players,
    ball: {
      position: { xM: fixture.pitch.lengthM / 2, yM: fixture.pitch.widthM / 2 },
      heightM: 0.11,
      outsidePitch: false,
      velocity: { xMps: 0, yMps: 0, zMps: 0 },
      controllerId: null, controlOffset: null, lastTouchPlayerId: null,
    },
    randomStreams: streams,
    pendingCommands: [],
    appliedCommands: [],
    contactEvents: [],
    automaticContactEvents: [],
    ballContactCooldownUntilTick: 0,
    nextCommandSequence: 1,
    ai: {
      enabledTeams: [false, false],
      lastDecisionTick: -1,
      lastPassTick: -1000,
      passIntent: null,
      decisionSnapshot: [],
      formationPositions: Object.fromEntries(players.map(p => [
        p.playerId, { ...p.position },
      ])),
    },
  }
  return { setup: fixture, state }
}
