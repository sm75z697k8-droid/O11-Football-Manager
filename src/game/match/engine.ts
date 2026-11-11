import { advanceSimulationClock, MAX_SIMULATION_TICK, restoreSimulationClock } from '../core/clock'
import { restoreRandomStream } from '../core/rng'
import {
  advanceControlledBall, resolveContactAttempts,
  expectedContactStream, FOOT_REACH_M,
} from '../physics/contact'
import {
  BALL_RADIUS_M, MAX_LAUNCH_SPEED_MPS, isBallFullyOutsidePitch, advanceBallPhysics,
} from '../physics/ball'
import type { MatchSetup } from '../model/match'
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

export const MATCH_CHECKPOINT_VERSION = 4 as const
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
      !Array.isArray(state.pendingCommands) || !Array.isArray(state.appliedCommands) ||
      !Array.isArray(state.contactEvents)) {
    throw new Error('Incomplete match state checkpoint')
  }
  const baseline = createInitialMatchState(setup).state
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
        (id !== 'ball/contact' &&
          (cp.drawCount !== 0 ||
            JSON.stringify(cp.words) !== JSON.stringify(baseline.randomStreams[id].words)))) {
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
        ((command.type === 'setMovementTarget' ||
          command.type === 'attemptFirstTouch' ||
          command.type === 'attemptKick') && !setup.players.some(
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
    } else if (command.type === 'setMovementTarget') {
      lastMotion.set(command.playerId, command as Extract<AppliedMatchCommand, {type: 'setMovementTarget'}>)
    }
  }
  if (state.teams.some((team) => team.pressingIntensity !== tactics[team.clubId])) {
    throw new Error('Tactical state disagrees with command history')
  }

  // Validate precisely one recorded outcome per applied contact request.
  const attempts = orderedApplied.filter((command) =>
    command.type === 'attemptFirstTouch' || command.type === 'attemptKick')
  if (state.contactEvents.length !== attempts.length) {
    throw new Error('Missing or extra player-ball contact events')
  }
  let consumedDraws = 0
  const eventById = new Map<string, (typeof state.contactEvents)[number]>()
  for (let i = 0; i < attempts.length; i += 1) {
    const command = attempts[i]
    const recorded = state.contactEvents[i]
    if (!recorded || typeof recorded !== 'object' ||
        recorded.commandId !== command.commandId ||
        recorded.playerId !== command.playerId ||
        recorded.tick !== command.appliedTick ||
        recorded.kind !== (command.type === 'attemptKick' ? 'kick' : 'control') ||
        ![0, 1].includes(recorded.drawUsed) ||
        !(
          command.type === 'attemptKick'
            ? ['kicked', 'outOfReach', 'occupied', 'invalidDirection'].includes(recorded.outcome)
            : ['controlled', 'miscontrolled', 'outOfReach', 'occupied', 'alreadyControlled'].includes(recorded.outcome)
        ) ||
        recorded.drawUsed !== (['kicked', 'controlled', 'miscontrolled'].includes(recorded.outcome) ? 1 : 0) ||
        Object.keys(recorded).sort().join(',') !==
          'commandId,drawUsed,kind,outcome,playerId,tick') {
      throw new Error('Invalid player-ball contact event history')
    }
    consumedDraws += recorded.drawUsed
    eventById.set(recorded.commandId, recorded)
  }
  if (JSON.stringify(state.randomStreams['ball/contact']) !==
      JSON.stringify(expectedContactStream(setup.seed, consumedDraws))) {
    throw new Error('Contact RNG stream does not match the recorded draw history')
  }

  // A diagnostic launch resets ownership and last touch; contact attempts
  // resolve after all queued launch commands and physical motion for that tick.
  let expectedController: string | null = null
  let expectedLastTouch: string | null = null
  for (const tick of [...new Set(orderedApplied.map((c) => c.appliedTick))]) {
    const due = orderedApplied.filter((c) => c.appliedTick === tick)
    if (due.some((c) => c.type === 'diagnosticBallLaunch')) {
      expectedController = null
      expectedLastTouch = null
    }
    for (const command of due) {
      if (command.type !== 'attemptFirstTouch' && command.type !== 'attemptKick') continue
      const recorded = eventById.get(command.commandId)
      if (!recorded) throw new Error('Missing applied contact outcome')
      if (recorded.outcome === 'controlled') {
        expectedController = command.playerId
        expectedLastTouch = command.playerId
      } else if (recorded.outcome === 'miscontrolled' ||
                 recorded.outcome === 'kicked') {
        expectedController = null
        expectedLastTouch = command.playerId
      }
    }
  }

  // Without a diagnostic launch or a reachable contact, the ball must remain
  // exactly at its original position. Other cases validate physical bounds.
  const launches = orderedApplied.filter((command) => command.type === 'diagnosticBallLaunch')
  if (!launches.length && !state.contactEvents.some((ev) =>
    ['kicked', 'miscontrolled', 'controlled'].includes(ev.outcome))) {
    if (JSON.stringify(state.ball) !== JSON.stringify(baseline.ball)) {
      throw new Error('Ball moved without an applied diagnostic launch')
    }
  } else {
    const ball = state.ball
    if (!object(ball.position) || !object(ball.velocity) ||
        typeof ball.heightM !== 'number' || !Number.isFinite(ball.heightM) ||
        ball.heightM < BALL_RADIUS_M - 1e-8 ||
        !Number.isFinite(ball.position.xM) || !Number.isFinite(ball.position.yM) ||
        Math.abs(ball.position.xM) > 3500 + setup.pitch.lengthM ||
        Math.abs(ball.position.yM) > 3500 + setup.pitch.widthM ||
        !Number.isFinite(ball.velocity.xMps) ||
        !Number.isFinite(ball.velocity.yMps) ||
        !Number.isFinite(ball.velocity.zMps) ||
        Math.hypot(ball.velocity.xMps, ball.velocity.yMps, ball.velocity.zMps) >
          MAX_LAUNCH_SPEED_MPS + 1e-8 ||
        (ball.heightM <= BALL_RADIUS_M + 1e-8 && ball.velocity.zMps < -1e-8) ||
        ball.controllerId !== expectedController ||
        ball.lastTouchPlayerId !== expectedLastTouch ||
        typeof ball.outsidePitch !== 'boolean' ||
        ball.outsidePitch !== isBallFullyOutsidePitch(
          ball.position.xM, ball.position.yM, setup.pitch)) {
      throw new Error('Ball checkpoint contains invalid flight, roll or contact state')
    }
    if (ball.controllerId !== null) {
      const player = state.players.find((p) => p.playerId === ball.controllerId)
      const offset = ball.controlOffset
      if (!player || !object(offset) ||
          !Number.isFinite(offset.xM) || !Number.isFinite(offset.yM) ||
          Math.hypot(offset.xM, offset.yM) > FOOT_REACH_M + 1e-9 ||
          ball.heightM !== BALL_RADIUS_M ||
          ball.velocity.zMps !== 0 ||
          Math.abs(ball.position.xM - (player.position.xM + offset.xM)) > 1e-8 ||
          Math.abs(ball.position.yM - (player.position.yM + offset.yM)) > 1e-8 ||
          ball.velocity.xMps !== player.velocity.xMps ||
          ball.velocity.yMps !== player.velocity.yMps) {
        throw new Error('Controlled ball is not physically attached to its owner')
      }
    } else if (ball.controlOffset !== null) {
      throw new Error('Free ball unexpectedly has a possession offset')
    }
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
        (!velocity || typeof velocity !== 'object' || Array.isArray(velocity)) || !Number.isFinite(velocity.xMps) ||
        !Number.isFinite(velocity.yMps) ||
        !Number.isFinite(orientationRad) ||
        orientationRad < -Math.PI - 1e-10 || orientationRad > Math.PI + 1e-10) {
      throw new Error('Invalid physical position, direction or velocity')
    }
    const limits = deriveMotionLimits(definition, player.energy)
    if (Math.hypot(velocity.xMps, velocity.yMps) > limits.maxSpeedMps + 1e-8) {
      throw new Error('Player exceeds their maximum physical speed')
    }
    if ((!intention || typeof intention !== 'object' || Array.isArray(intention)) || !Number.isSafeInteger(intention.sinceTick) ||
        intention.sinceTick < motion.appliedTick ||
        intention.sinceTick > state.clock.tick) {
      throw new Error('Invalid player locomotion intention')
    }
    if (intention.kind === 'moveToPoint') {
      if (intention.sinceTick !== motion.appliedTick ||
          (!intention.target || typeof intention.target !== 'object' || Array.isArray(intention.target)) ||
          !insidePitch(intention.target, setup.pitch) ||
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

  /** Fixed-step player and free-ball physics; no actual football gameplay. */
  advance(steps = 1): MatchState {
    if (!Number.isSafeInteger(steps) || steps < 0 ||
        steps > MAX_ADVANCE_STEPS_PER_CALL ||
        steps > MAX_SIMULATION_TICK - this.state.clock.tick) {
      throw new RangeError('Invalid engine advance step count')
    }
    for (let i = 0; i < steps; i += 1) {
      const clock = advanceSimulationClock(this.state.clock)
      const applied = applyDueMatchCommands({ ...this.state, clock })
      const agents = advancePlayerLocomotion(applied, this.setup.players, this.setup.pitch)
      const controller = agents.ball.controllerId
        ? agents.players.find((p) => p.playerId === agents.ball.controllerId)
        : null
      if (agents.ball.controllerId && !controller) {
        throw new Error('Ball controller is missing')
      }
      const ball = controller
        ? advanceControlledBall(agents.ball, controller, this.setup.pitch)
        : advanceBallPhysics(agents.ball, this.setup.pitch)
      const moved = ball === agents.ball ? agents : { ...agents, ball }
      this.state = resolveContactAttempts(moved, this.setup)
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
