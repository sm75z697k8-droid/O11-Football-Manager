import type { MatchState, PressingIntensity } from './state'
import { MAX_SIMULATION_TICK } from '../core/clock'

export const MAX_COMMANDS_PER_MATCH = 256

/** The only Phase 0D command: update stored tactical intent, not player AI. */
export interface SetPressingCommandRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'setPressingIntensity'
  readonly intensity: PressingIntensity
}
export type MatchCommandRequest = SetPressingCommandRequest

export interface ScheduledMatchCommand extends SetPressingCommandRequest {
  readonly requestedTick: number
  readonly targetTick: number
  readonly sequence: number
}
export interface AppliedMatchCommand extends ScheduledMatchCommand {
  readonly appliedTick: number
}

export type CommandReceipt =
  | { readonly accepted: true; readonly commandId: string; readonly targetTick: number; readonly sequence: number }
  | { readonly accepted: false; readonly commandId: string | null; readonly reason: string }

const VALID_INTENSITIES: readonly PressingIntensity[] = ['low', 'standard', 'high']
const REQUEST_FIELDS = ['commandId', 'teamId', 'type', 'intensity']

function parseRequest(input: unknown): { request: MatchCommandRequest } | { reason: string; commandId: string | null } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { reason: 'Command must be an object', commandId: null }
  }
  const value = input as Record<string, unknown>
  const commandId = typeof value.commandId === 'string' ? value.commandId : null
  if (!commandId || commandId.trim().length === 0 || commandId.length > 128) {
    return { reason: 'Invalid command identifier', commandId }
  }
  if (Object.keys(value).some((field) => !REQUEST_FIELDS.includes(field))) {
    return { reason: 'Unexpected command field', commandId }
  }
  if (value.type !== 'setPressingIntensity') {
    return { reason: 'Unsupported command type', commandId }
  }
  if (typeof value.teamId !== 'string' || value.teamId.length === 0) {
    return { reason: 'Invalid team identifier', commandId }
  }
  if (!VALID_INTENSITIES.includes(value.intensity as PressingIntensity)) {
    return { reason: 'Invalid pressing intensity', commandId }
  }
  return {
    request: {
      commandId, teamId: value.teamId,
      type: 'setPressingIntensity',
      intensity: value.intensity as PressingIntensity,
    },
  }
}

/** Pure scheduler: assigns the earliest next logical step and a stable sequence. */
export function scheduleMatchCommand(
  state: MatchState, input: unknown,
): { state: MatchState; receipt: CommandReceipt } {
  const parsed = parseRequest(input)
  if ('reason' in parsed) {
    return { state, receipt: { accepted: false, commandId: parsed.commandId, reason: parsed.reason } }
  }
  const req = parsed.request
  const reject = (reason: string) => ({
    state,
    receipt: { accepted: false as const, commandId: req.commandId, reason },
  })
  if (!state.teams.some((team) => team.clubId === req.teamId)) return reject('Unknown match team')
  if (state.pendingCommands.some((command) => command.commandId === req.commandId) ||
      state.appliedCommands.some((command) => command.commandId === req.commandId)) {
    return reject('Duplicate command identifier')
  }
  if (state.nextCommandSequence > MAX_COMMANDS_PER_MATCH) return reject('Match command capacity exceeded')
  if (state.clock.tick >= MAX_SIMULATION_TICK) return reject('Simulation clock cannot advance')
  const command: ScheduledMatchCommand = {
    ...req,
    requestedTick: state.clock.tick,
    targetTick: state.clock.tick + 1,
    sequence: state.nextCommandSequence,
  }
  return {
    state: {
      ...state,
      nextCommandSequence: state.nextCommandSequence + 1,
      pendingCommands: [...state.pendingCommands, command],
    },
    receipt: {
      accepted: true, commandId: command.commandId,
      targetTick: command.targetTick, sequence: command.sequence,
    },
  }
}

/** Apply due commands in (targetTick, sequence) order. Never move players. */
export function applyDueMatchCommands(state: MatchState): MatchState {
  if (state.pendingCommands.length === 0) return state
  const due = state.pendingCommands
    .filter((command) => command.targetTick <= state.clock.tick)
    .sort((a, b) => a.targetTick - b.targetTick || a.sequence - b.sequence)
  if (due.length === 0) return state
  let teams = state.teams
  for (const command of due) {
    teams = teams.map((team) => team.clubId === command.teamId
      ? { ...team, pressingIntensity: command.intensity }
      : team) as unknown as typeof teams
  }
  const applied: AppliedMatchCommand[] = due.map((command) => ({
    ...command, appliedTick: state.clock.tick,
  }))
  const appliedIds = new Set(due.map((command) => command.commandId))
  return {
    ...state,
    teams,
    pendingCommands: state.pendingCommands.filter((command) => !appliedIds.has(command.commandId)),
    appliedCommands: [...state.appliedCommands, ...applied],
  }
}
