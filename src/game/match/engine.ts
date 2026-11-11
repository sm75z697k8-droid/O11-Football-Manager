import { advanceSimulationClock, restoreSimulationClock } from '../core/clock'
import { MAX_SIMULATION_TICK } from '../core/clock'
import { restoreRandomStream } from '../core/rng'
import type { MatchSetup } from '../model/match'
import { assertValidMatchSetup } from '../../data/validate'
import {
  MAX_COMMANDS_PER_MATCH, applyDueMatchCommands, scheduleMatchCommand,
} from './commands'
import type { CommandReceipt, ScheduledMatchCommand, AppliedMatchCommand } from './commands'
import { createInitialMatchState } from './setup'
import {
  FOUNDATION_ENGINE_VERSION, MATCH_RANDOM_STREAM_IDS, MATCH_STATE_SCHEMA_VERSION,
} from './state'
import type { MatchState, PressingIntensity } from './state'

export const MATCH_CHECKPOINT_VERSION = 1 as const
export const MAX_ADVANCE_STEPS_PER_CALL = 10_000 as const

export interface FoundationMatchCheckpoint {
  readonly checkpointVersion: typeof MATCH_CHECKPOINT_VERSION
  readonly setup: MatchSetup
  readonly state: MatchState
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertCommand(value: unknown, expectedApplied: boolean): asserts value is ScheduledMatchCommand & Partial<AppliedMatchCommand> {
  if (!object(value)) throw new Error('Invalid checkpoint command')
  if (typeof value.commandId !== 'string' || !value.commandId.trim() ||
      typeof value.teamId !== 'string' || !value.teamId.trim() ||
      value.type !== 'setPressingIntensity' ||
      !['low', 'standard', 'high'].includes(value.intensity as string) ||
      !Number.isSafeInteger(value.requestedTick) ||
      !Number.isSafeInteger(value.targetTick) ||
      !Number.isSafeInteger(value.sequence)) {
    throw new Error('Invalid checkpoint command fields')
  }
  if (expectedApplied && !Number.isSafeInteger(value.appliedTick)) {
    throw new Error('Applied command lacks execution tick')
  }
  if (!expectedApplied && 'appliedTick' in value) {
    throw new Error('Pending command must not have an execution tick')
  }
}

/**
 * Phase 0D checkpoint validation is intentionally strict about immutable
 * diagnostic match state: no on-field football mechanics exist yet.
 * Later engine versions may extend this schema deliberately.
 */
function validateRestoredState(setup: MatchSetup, value: unknown): MatchState {
  if (!object(value) || value.schemaVersion !== MATCH_STATE_SCHEMA_VERSION ||
      value.engineVersion !== FOUNDATION_ENGINE_VERSION ||
      value.matchId !== setup.matchId || value.seed !== setup.seed ||
      value.period !== 'notStarted') {
    throw new Error('Incompatible or invalid match state checkpoint')
  }
  const state = value as unknown as MatchState
  restoreSimulationClock(state.clock)

  if (!Array.isArray(state.players) || state.players.length !== 22 ||
      !Array.isArray(state.teams) || state.teams.length !== 2 ||
      !object(state.ball) || !object(state.randomStreams) ||
      !Array.isArray(state.pendingCommands) || !Array.isArray(state.appliedCommands)) {
    throw new Error('Incomplete match state')
  }

  const baseline = createInitialMatchState(setup).state
  // Positions, physical states and ball properties cannot change in Phase 0D.
  // Command-driven team pressing intent is handled separately.
  if (JSON.stringify(state.players) !== JSON.stringify(baseline.players) ||
      JSON.stringify(state.ball) !== JSON.stringify(baseline.ball)) {
    throw new Error('Invalid physical or participant state in checkpoint')
  }

  if (state.teams.some((team, i) =>
      !object(team) || team.clubId !== baseline.teams[i].clubId ||
      team.attackingDirection !== baseline.teams[i].attackingDirection ||
      team.score !== 0 ||
      !['low', 'standard', 'high'].includes(team.pressingIntensity))) {
    throw new Error('Invalid team state in checkpoint')
  }

  if (Object.keys(state.randomStreams).length !== MATCH_RANDOM_STREAM_IDS.length) {
    throw new Error('Unexpected RNG streams')
  }
  for (const id of MATCH_RANDOM_STREAM_IDS) {
    const stream = restoreRandomStream(state.randomStreams[id])
    if (stream.streamId !== id || stream.masterSeed !== setup.seed ||
        stream.checkpoint().drawCount !== 0 ||
        JSON.stringify(stream.checkpoint().words) !== JSON.stringify(baseline.randomStreams[id].words)) {
      throw new Error('Unexpected Phase 0D random stream state')
    }
  }
  if (!Number.isSafeInteger(state.nextCommandSequence) ||
      state.nextCommandSequence < 1 ||
      state.nextCommandSequence > MAX_COMMANDS_PER_MATCH + 1) {
    throw new Error('Invalid command sequence counter')
  }
  const seenCommands = new Set<string>()
  const allCommands = [...state.pendingCommands, ...state.appliedCommands]
  if (allCommands.length !== state.nextCommandSequence - 1) {
    throw new Error('Missing or duplicated command sequence entries')
  }

  const order = [...allCommands].sort((a, b) => a.sequence - b.sequence)
  for (let i = 0; i < order.length; i += 1) {
    const command = order[i]
    const applied = state.appliedCommands.includes(command as AppliedMatchCommand)
    assertCommand(command, applied)
    if (command.sequence !== i + 1 ||
        command.targetTick !== command.requestedTick + 1 ||
        command.requestedTick < 0 || command.requestedTick > state.clock.tick ||
        command.targetTick > MAX_SIMULATION_TICK ||
        !setup.clubs.some((club) => club.id === command.teamId) ||
        seenCommands.has(command.commandId)) {
      throw new Error('Invalid scheduled command history')
    }
    if (applied) {
      if (command.appliedTick !== command.targetTick || command.appliedTick > state.clock.tick) {
        throw new Error('Invalid applied command timestamp')
      }
    } else if (command.targetTick <= state.clock.tick) {
      throw new Error('Overdue command remained pending')
    }
    seenCommands.add(command.commandId)
  }

  const expectedIntensity: Record<string, PressingIntensity> = Object.fromEntries(
    setup.clubs.map((club) => [club.id, 'standard' as const]),
  )
  for (const command of [...state.appliedCommands].sort((a, b) =>
      a.targetTick - b.targetTick || a.sequence - b.sequence)) {
    expectedIntensity[command.teamId] = command.intensity
  }
  if (state.teams.some((team) => team.pressingIntensity !== expectedIntensity[team.clubId])) {
    throw new Error('Team tactics disagree with applied command history')
  }
  return state
}

/** The engine owns state; external callers only receive detached snapshots. */
export class FoundationMatchEngine {
  private readonly setup: MatchSetup
  private state: MatchState

  private constructor(setup: MatchSetup, state: MatchState) {
    this.setup = setup
    this.state = state
  }

  static create(input: unknown): FoundationMatchEngine {
    const { setup, state } = createInitialMatchState(input)
    return new FoundationMatchEngine(setup, state)
  }

  static restore(input: unknown): FoundationMatchEngine {
    if (!object(input) || input.checkpointVersion !== MATCH_CHECKPOINT_VERSION) {
      throw new Error('Unsupported match checkpoint version')
    }
    const setup = structuredClone(assertValidMatchSetup(input.setup))
    const restored = validateRestoredState(setup, input.state)
    return new FoundationMatchEngine(setup, structuredClone(restored))
  }

  getState(): MatchState {
    return structuredClone(this.state)
  }

  getSetup(): MatchSetup {
    return structuredClone(this.setup)
  }

  submitCommand(request: unknown): CommandReceipt {
    const { state, receipt } = scheduleMatchCommand(this.state, request)
    this.state = state
    return receipt
  }

  /**
   * Run exactly N logical ticks. No browser timers or canvas.
   * This version only advances the diagnostic clock and applies commands.
   */
  advance(steps = 1): MatchState {
    if (!Number.isSafeInteger(steps) || steps < 0 || steps > MAX_ADVANCE_STEPS_PER_CALL ||
        steps > MAX_SIMULATION_TICK - this.state.clock.tick) {
      throw new RangeError('Invalid foundation engine advance step count')
    }
    for (let i = 0; i < steps; i += 1) {
      const next = {
        ...this.state,
        clock: advanceSimulationClock(this.state.clock),
      }
      this.state = applyDueMatchCommands(next)
    }
    return this.getState()
  }

  checkpoint(): FoundationMatchCheckpoint {
    return {
      checkpointVersion: MATCH_CHECKPOINT_VERSION,
      setup: this.getSetup(),
      state: this.getState(),
    }
  }
}

/** Create one real authoritative match state from exactly two fictional teams. */
export function createFoundationMatch(input: unknown): FoundationMatchEngine {
  return FoundationMatchEngine.create(input)
}

export function restoreFoundationMatch(checkpoint: unknown): FoundationMatchEngine {
  return FoundationMatchEngine.restore(checkpoint)
}
