import { advanceSimulationClock, MAX_SIMULATION_TICK, restoreSimulationClock } from '../core/clock'
import { restoreRandomStream } from '../core/rng'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import { deriveMotionLimits, advancePlayerLocomotion, insidePitch } from '../physics/locomotion'
import { assertValidMatchSetup } from '../../data/validate'
import {
  MAX_COMMANDS_PER_MATCH, applyDueMatchCommands, parseMatchCommandRequest,
  scheduleMatchCommand,
} from './commands'
import type {
  CommandReceipt, ScheduledMatchCommand, AppliedMatchCommand,
} from './commands'
import { createInitialMatchState } from './setup'
import {
  FOUNDATION_ENGINE_VERSION, MATCH_RANDOM_STREAM_IDS, MATCH_STATE_SCHEMA_VERSION,
} from './state'
import type { MatchState, PressingIntensity } from './state'

export const MATCH_CHECKPOINT_VERSION = 2 as const
export const MAX_ADVANCE_STEPS_PER_CALL = 10_000 as const

export interface FoundationMatchCheckpoint {
  readonly checkpointVersion: typeof MATCH_CHECKPOINT_VERSION
  readonly setup: MatchSetup
  readonly state: MatchState
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertCommand(
  value: unknown, applied: boolean, setup: MatchSetup,
): asserts value is ScheduledMatchCommand & Partial<AppliedMatchCommand> {
  if (!object(value)) throw new Error('Invalid checkpoint command')
  const fields = ['requestedTick', 'targetTick', 'sequence', 'appliedTick']
  const userFields = Object.fromEntries(Object.entries(value)
    .filter(([k]) => !fields.includes(k)))
  const result = parseMatchCommandRequest(userFields, setup.pitch)
  if ('reason' in result) throw new Error('Malformed checkpoint command: ' + result.reason)
  const expected = [...Object.keys(result.request),
    'requestedTick', 'targetTick', 'sequence', ...(applied ? ['appliedTick'] : [])]
  if (Object.keys(value).some((key) => !expected.includes(key))) {
    throw new Error('Unexpected checkpoint command field')
  }
  if (!Number.isSafeInteger(value.requestedTick) ||
      !Number.isSafeInteger(value.targetTick) ||
      !Number.isSafeInteger(value.sequence) ||
      (applied && !Number.isSafeInteger(value.appliedTick))) {
    throw new Error('Invalid checkpoint tick or sequence')
  }
  if (!applied && 'appliedTick' in value) throw new Error('Pending command marked as applied')
}

/**
 * Validate a complete current-version checkpoint before trusting saved state.
 * Limits enforce plausible motion but are NOT cryptographic save authentication.
 */
function validateRestoredState(setup: MatchSetup, input: unknown): MatchState {
  if (!object(input) || input.schemaVersion !== MATCH_STATE_SCHEMA_VERSION ||
      input.engineVersion !== FOUNDATION_ENGINE_VERSION ||
      input.matchId !== setup.matchId || input.seed !== setup.seed ||
      input.period !== 'notStarted') {
    throw new Error('Incompatible or invalid match state checkpoint')
  }
  const state = input as unknown as MatchState
  restoreSimulationClock(state.clock)
  if (!Array.isArray(state.players) || state.players.length !== 22 ||
      !Array.isArray(state.teams) || state.teams.length !== 2 ||
      !object(state.ball) || !object(state.randomStreams) ||
      !Array.isArray(state.pendingCommands) || !Array.isArray(state.appliedCommands)) {
    throw new Error('Incomplete match state checkpoint')
  }
  const baseline = createInitialMatchState(setup).state
  if (JSON.stringify(state.ball) !== JSON.stringify(baseline.ball)) {
    throw new Error('Ball movement is not implemented in Phase 1')
  }
  if (state.teams.some((team, i) =>
    !object(team) || team.clubId !== baseline.teams[i].clubId ||
    team.attackingDirection !== baseline.teams[i].attackingDirection ||
    team.score !== 0 ||
    !['low', 'standard', 'high'].includes(team.pressingIntensity))) {
    throw new Error('Invalid team state in checkpoint')
  }
  if (Object.keys(state.randomStreams).length !== MATCH_RANDOM_STREAM_IDS.length) {
    throw new Error('Unexpected number of RNG streams')
  }
  for (const id of MATCH_RANDOM_STREAM_IDS) {
    const stream = restoreRandomStream(state.randomStreams[id])
    const cp = stream.checkpoint()
    if (cp.streamId !== id || cp.masterSeed !== setup.seed ||
        cp.drawCount !== 0 ||
        JSON.stringify(cp.words) !== JSON.stringify(baseline.randomStreams[id].words)) {
      throw new Error('Invalid or modified Phase 1 RNG stream')
    }
  }
  if (!Number.isSafeInteger(state.nextCommandSequence) ||
      state.nextCommandSequence < 1 ||
      state.nextCommandSequence > MAX_COMMANDS_PER_MATCH + 1) {
    throw new Error('Invalid command sequence counter')
  }
  const commands = [...state.pendingCommands, ...state.appliedCommands]
  if (commands.length !== state.nextCommandSequence - 1) {
    throw new Error('Missing or extra command history entries')
  }
  const ordered = [...commands].sort((a, b) => a.sequence - b.sequence)
  const seen = new Set<string>()
  for (let index = 0; index < ordered.length; index += 1) {
    const command = ordered[index]
    const applied = state.appliedCommands.includes(command as AppliedMatchCommand)
    assertCommand(command, applied, setup)
    if (command.sequence !== index + 1 ||
        command.targetTick !== command.requestedTick + 1 ||
        command.requestedTick < 0 || command.requestedTick > state.clock.tick ||
        command.targetTick > MAX_SIMULATION_TICK ||
        !setup.clubs.some((club) => club.id === command.teamId) ||
        (command.type === 'setMovementTarget' && !setup.players.some(
          (p) => p.id === command.playerId && p.clubId === command.teamId)) ||
        seen.has(command.commandId)) {
      throw new Error('Invalid checkpoint command chronology')
    }
    if (applied) {
      if (command.appliedTick !== command.targetTick ||
          command.appliedTick > state.clock.tick) {
        throw new Error('Invalid applied command timing')
      }
    } else if (command.targetTick <= state.clock.tick) {
      throw new Error('Overdue movement or tactic command')
    }
    seen.add(command.commandId)
  }

  // Store tactical intent exactly as the ordered applied commands dictate.
  const tactics: Record<string, PressingIntensity> = Object.fromEntries(
    setup.clubs.map((club) => [club.id, 'standard' as const]),
  )
  const orderedApplied = [...state.appliedCommands].sort(
    (a, b) => a.targetTick - b.targetTick || a.sequence - b.sequence,
  )
  const lastMotion = new Map<string, Extract<AppliedMatchCommand, {type: 'setMovementTarget'}>>()
  for (const command of orderedApplied) {
    if (command.type === 'setPressingIntensity') {
      tactics[command.teamId] = command.intensity
    } else {
      lastMotion.set(command.playerId, command as Extract<AppliedMatchCommand, {type: 'setMovementTarget'}>)
    }
  }
  if (state.teams.some((team) => team.pressingIntensity !== tactics[team.clubId])) {
    throw new Error('Tactical state disagrees with command history')
  }

  const currentPlayers = state.players
  for (let i = 0; i < currentPlayers.length; i += 1) {
    const player = currentPlayers[i]
    const original = baseline.players[i]
    if (!player || typeof player !== 'object') throw new Error('Invalid player state')

    const { position, velocity, orientationRad, intention, ...metadata } = player
    const {
      position: _initialPosition, velocity: _initialVelocity,
      orientationRad: _initialOrientation, intention: _initialIntention, ...expected
    } = original
    void _initialPosition
    void _initialVelocity
    void _initialOrientation
    void _initialIntention
    if (JSON.stringify(metadata) !== JSON.stringify(expected)) {
      throw new Error('Player identity, physical condition or roster was modified')
    }

    const motion = lastMotion.get(player.playerId)
    if (!motion) {
      if (JSON.stringify(player) !== JSON.stringify(original)) {
        throw new Error('Player moved without an authoritative movement command')
      }
      continue
    }
    const definition = setup.players.find((p) => p.id === player.playerId)
    if (!definition || !insidePitch(position, setup.pitch) ||
        !object(velocity) || !Number.isFinite(velocity.xMps) ||
        !Number.isFinite(velocity.yMps) ||
        !Number.isFinite(orientationRad) ||
        orientationRad < -Math.PI - 1e-10 || orientationRad > Math.PI + 1e-10) {
      throw new Error('Invalid physical position, direction or velocity')
    }
    const limits = deriveMotionLimits(definition, player.energy)
    if (Math.hypot(velocity.xMps, velocity.yMps) > limits.maxSpeedMps + 1e-8) {
      throw new Error('Player exceeds their maximum physical speed')
    }
    if (!object(intention) || !Number.isSafeInteger(intention.sinceTick) ||
        intention.sinceTick < motion.appliedTick ||
        intention.sinceTick > state.clock.tick) {
      throw new Error('Invalid player locomotion intention')
    }
    if (intention.kind === 'moveToPoint') {
      if (intention.sinceTick !== motion.appliedTick ||
          !object(intention.target) ||
          !insidePitch(intention.target as unknown as Point2, setup.pitch) ||
          JSON.stringify(intention.target) !== JSON.stringify(motion.target)) {
        throw new Error('Movement target differs from the latest applied instruction')
      }
    } else if (intention.kind === 'holdFormation') {
      if (velocity.xMps !== 0 || velocity.yMps !== 0) {
        throw new Error('Idle player still has physical velocity')
      }
    } else {
      throw new Error('Unsupported player locomotion intention')
    }
  }
  return state
}

/** Match state is private; the client only receives detached snapshots. */
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
      throw new Error('Unsupported movement-engine checkpoint version')
    }
    const setup = structuredClone(assertValidMatchSetup(input.setup))
    const restored = validateRestoredState(setup, input.state)
    return new FoundationMatchEngine(setup, structuredClone(restored))
  }

  getState(): MatchState { return structuredClone(this.state) }
  getSetup(): MatchSetup { return structuredClone(this.setup) }

  submitCommand(request: unknown): CommandReceipt {
    const { state, receipt } = scheduleMatchCommand(this.state, request, this.setup.pitch)
    this.state = state
    return receipt
  }

  /** Fixed-step physical movement only, with no real match clock or ball physics. */
  advance(steps = 1): MatchState {
    if (!Number.isSafeInteger(steps) || steps < 0 ||
        steps > MAX_ADVANCE_STEPS_PER_CALL ||
        steps > MAX_SIMULATION_TICK - this.state.clock.tick) {
      throw new RangeError('Invalid engine advance step count')
    }
    for (let i = 0; i < steps; i += 1) {
      const clock = advanceSimulationClock(this.state.clock)
      const applied = applyDueMatchCommands({ ...this.state, clock })
      this.state = advancePlayerLocomotion(applied, this.setup.players, this.setup.pitch)
    }
    return this.getState()
  }

  checkpoint(): FoundationMatchCheckpoint {
    return {
      checkpointVersion: MATCH_CHECKPOINT_VERSION,
      setup: this.getSetup(), state: this.getState(),
    }
  }
}

export function createFoundationMatch(input: unknown): FoundationMatchEngine {
  return FoundationMatchEngine.create(input)
}
export function restoreFoundationMatch(input: unknown): FoundationMatchEngine {
  return FoundationMatchEngine.restore(input)
}
