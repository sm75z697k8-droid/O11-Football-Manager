import { MAX_SIMULATION_TICK } from '../core/clock'
import type { PitchDefinition, Point2 } from '../model/pitch'
import { validDiagnosticLaunchVelocity, launchDiagnosticBall } from '../physics/ball'
import type { BallVelocity } from '../physics/ball'
import { insidePitch } from '../physics/locomotion'
import type { MatchState, PressingIntensity } from './state'

export const MAX_COMMANDS_PER_MATCH = 256
export interface SetPressingCommandRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'setPressingIntensity'
  readonly intensity: PressingIntensity
}
export interface SetMovementTargetRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'setMovementTarget'
  readonly playerId: string
  readonly target: Point2
}
/** A test impulse, NOT a pass, shot, kick decision or player contact. */
export interface DiagnosticBallLaunchRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'diagnosticBallLaunch'
  readonly velocity: BallVelocity
}
export type MatchCommandRequest =
  | SetPressingCommandRequest | SetMovementTargetRequest | DiagnosticBallLaunchRequest
export type ScheduledMatchCommand = MatchCommandRequest & {
  readonly requestedTick: number
  readonly targetTick: number
  readonly sequence: number
}
export type AppliedMatchCommand = ScheduledMatchCommand & { readonly appliedTick: number }
export type CommandReceipt =
  | { readonly accepted: true; readonly commandId: string; readonly targetTick: number; readonly sequence: number }
  | { readonly accepted: false; readonly commandId: string | null; readonly reason: string }

const INTENSITIES: readonly PressingIntensity[] = ['low', 'standard', 'high']
const PRESSING_FIELDS = ['commandId', 'teamId', 'type', 'intensity']
const MOVEMENT_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'target']
const BALL_LAUNCH_FIELDS = ['commandId', 'teamId', 'type', 'velocity']

export function parseMatchCommandRequest(
  input: unknown, pitch: PitchDefinition,
): { request: MatchCommandRequest } | { reason: string; commandId: string | null } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { reason: 'Command must be an object', commandId: null }
  }
  const value = input as Record<string, unknown>
  const commandId = typeof value.commandId === 'string' ? value.commandId : null
  if (!commandId || !commandId.trim() || commandId.length > 128) {
    return { reason: 'Invalid command identifier', commandId }
  }
  if (typeof value.teamId !== 'string' || !value.teamId.trim()) {
    return { reason: 'Invalid team identifier', commandId }
  }
  if (value.type === 'setPressingIntensity') {
    if (Object.keys(value).some((k) => !PRESSING_FIELDS.includes(k)) ||
        !INTENSITIES.includes(value.intensity as PressingIntensity)) {
      return { reason: 'Invalid pressing command', commandId }
    }
    return { request: {
      commandId, teamId: value.teamId, type: 'setPressingIntensity',
      intensity: value.intensity as PressingIntensity,
    } }
  }
  if (value.type === 'setMovementTarget') {
    const point = value.target
    if (Object.keys(value).some((k) => !MOVEMENT_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        !point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).some((k) => k !== 'xM' && k !== 'yM') ||
        !insidePitch(point as Point2, pitch)) {
      return { reason: 'Invalid movement target', commandId }
    }
    const p = point as Point2
    return { request: {
      commandId, teamId: value.teamId, type: 'setMovementTarget',
      playerId: value.playerId, target: { xM: p.xM, yM: p.yM },
    } }
  }
  if (value.type === 'diagnosticBallLaunch') {
    if (Object.keys(value).some((k) => !BALL_LAUNCH_FIELDS.includes(k)) ||
        !validDiagnosticLaunchVelocity(value.velocity)) {
      return { reason: 'Invalid diagnostic ball velocity', commandId }
    }
    const v = value.velocity as BallVelocity
    return { request: {
      commandId, teamId: value.teamId, type: 'diagnosticBallLaunch',
      velocity: { xMps: v.xMps, yMps: v.yMps, zMps: v.zMps },
    } }
  }
  return { reason: 'Unsupported command type', commandId }
}

/** Stable next-tick commands, independent of wall clock / rendering. */
export function scheduleMatchCommand(
  state: MatchState, input: unknown, pitch: PitchDefinition,
): { state: MatchState; receipt: CommandReceipt } {
  const parsed = parseMatchCommandRequest(input, pitch)
  if ('reason' in parsed) {
    return { state, receipt: { accepted: false, commandId: parsed.commandId, reason: parsed.reason } }
  }
  const req = parsed.request
  const reject = (reason: string) => ({
    state, receipt: { accepted: false as const, commandId: req.commandId, reason },
  })
  if (!state.teams.some((team) => team.clubId === req.teamId)) return reject('Unknown match team')
  if (req.type === 'setMovementTarget' &&
      !state.players.some((p) => p.playerId === req.playerId && p.clubId === req.teamId)) {
    return reject('Player does not belong to the specified team')
  }
  if (state.pendingCommands.some((command) => command.commandId === req.commandId) ||
      state.appliedCommands.some((command) => command.commandId === req.commandId)) {
    return reject('Duplicate command identifier')
  }
  if (state.nextCommandSequence > MAX_COMMANDS_PER_MATCH) return reject('Match command capacity exceeded')
  if (state.clock.tick >= MAX_SIMULATION_TICK) return reject('Simulation clock cannot advance')
  const command: ScheduledMatchCommand = {
    ...req, requestedTick: state.clock.tick,
    targetTick: state.clock.tick + 1, sequence: state.nextCommandSequence,
  }
  return {
    state: { ...state, nextCommandSequence: state.nextCommandSequence + 1,
      pendingCommands: [...state.pendingCommands, command] },
    receipt: { accepted: true, commandId: command.commandId,
      targetTick: command.targetTick, sequence: command.sequence },
  }
}

/** Apply due commands BEFORE physical movement at the target tick. */
export function applyDueMatchCommands(state: MatchState): MatchState {
  if (!state.pendingCommands.length) return state
  const due = state.pendingCommands
    .filter((command) => command.targetTick <= state.clock.tick)
    .sort((a, b) => a.targetTick - b.targetTick || a.sequence - b.sequence)
  if (!due.length) return state
  let teams = state.teams
  let players = state.players
  let ball = state.ball
  for (const command of due) {
    if (command.type === 'setPressingIntensity') {
      teams = teams.map((team) => team.clubId === command.teamId
        ? { ...team, pressingIntensity: command.intensity }
        : team) as unknown as typeof teams
    } else if (command.type === 'setMovementTarget') {
      players = players.map((p) => p.playerId === command.playerId
        ? { ...p, intention: { kind: 'moveToPoint' as const,
          sinceTick: state.clock.tick, target: { ...command.target } } }
        : p)
    } else {
      ball = launchDiagnosticBall(ball, command.velocity)
    }
  }
  const applied: AppliedMatchCommand[] = due.map((command) => ({
    ...command, appliedTick: state.clock.tick,
  }))
  const ids = new Set(due.map((command) => command.commandId))
  return {
    ...state, teams, players, ball,
    pendingCommands: state.pendingCommands.filter((command) => !ids.has(command.commandId)),
    appliedCommands: [...state.appliedCommands, ...applied],
  }
}
