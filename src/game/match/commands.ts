import { MAX_SIMULATION_TICK } from '../core/clock'
import type { PitchDefinition, Point2 } from '../model/pitch'
import { validDiagnosticLaunchVelocity, launchDiagnosticBall } from '../physics/ball'
import type { BallVelocity } from '../physics/ball'
import { insidePitch } from '../physics/locomotion'
import type { MatchState, PressingIntensity } from './state'

/** Safety ceiling, not a ten-minute football match limit. At observed
 * ~20-30 physical action commands per simulated minute, 8192 safely
 * accommodates a full match. A future compacted journal can replace it.
 */
export const MAX_COMMANDS_PER_MATCH = 8192
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
/** Contact requests are scheduled; actual reach/success is evaluated at execution. */
export interface AttemptFirstTouchRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'attemptFirstTouch'
  readonly playerId: string
}
export interface AttemptKickRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'attemptKick'
  readonly playerId: string
  readonly target: Point2
  readonly power: number
  readonly lift: number
}
/** Physically release a ball held in a goalkeeper's hands. */
export interface AttemptGoalkeeperThrowRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'attemptGoalkeeperThrow'
  readonly playerId: string
  readonly target: Point2
  readonly power: number
}
/** Toggle physical contact intent; physics handles entry automatically thereafter. */
/** Throw-in is a legal restart, never a ground kick or GK distribution. */
/** A foot kick from a stationary ball in the defending goal area. */
/** Foot kick from a stationary, lawfully located corner-area ball. */
export interface AttemptCornerKickRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'attemptCornerKick'
  readonly playerId: string
  readonly target: Point2
  readonly power: number
  readonly lift: number
}
export interface AttemptGoalKickRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'attemptGoalKick'
  readonly playerId: string
  readonly target: Point2
  readonly power: number
  readonly lift: number
}
export interface AttemptThrowInRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'attemptThrowIn'
  readonly playerId: string
  readonly target: Point2
  readonly power: number
}
export interface SetBallEngagementRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'setBallEngagement'
  readonly playerId: string
  readonly enabled: boolean
}
/** Opt-in autonomous behavior independently for either fictional team. */
export interface SetAutonomousTeamRequest {
  readonly commandId: string
  readonly teamId: string
  readonly type: 'setAutonomousTeam'
  readonly enabled: boolean
}
export type MatchCommandRequest =
  | SetPressingCommandRequest | SetMovementTargetRequest
  | DiagnosticBallLaunchRequest | AttemptFirstTouchRequest | AttemptKickRequest
  | AttemptGoalkeeperThrowRequest | AttemptThrowInRequest
  | AttemptGoalKickRequest | AttemptCornerKickRequest
  | SetBallEngagementRequest | SetAutonomousTeamRequest
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
const FIRST_TOUCH_FIELDS = ['commandId', 'teamId', 'type', 'playerId']
const KICK_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'target', 'power', 'lift']
const THROW_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'target', 'power']
const THROW_IN_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'target', 'power']
const GOAL_KICK_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'target', 'power', 'lift']
const CORNER_KICK_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'target', 'power', 'lift']
const ENGAGEMENT_FIELDS = ['commandId', 'teamId', 'type', 'playerId', 'enabled']
const AUTONOMY_FIELDS = ['commandId', 'teamId', 'type', 'enabled']

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
  if (value.type === 'setAutonomousTeam') {
    if (Object.keys(value).some((k) => !AUTONOMY_FIELDS.includes(k)) ||
        typeof value.enabled !== 'boolean') {
      return { reason: 'Invalid autonomous team toggle', commandId }
    }
    return { request: {
      commandId, teamId: value.teamId,
      type: 'setAutonomousTeam', enabled: value.enabled,
    } }
  }
  if (value.type === 'setBallEngagement') {
    if (Object.keys(value).some((k) => !ENGAGEMENT_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        typeof value.enabled !== 'boolean') {
      return { reason: 'Invalid ball engagement request', commandId }
    }
    return { request: {
      commandId, teamId: value.teamId, type: 'setBallEngagement',
      playerId: value.playerId, enabled: value.enabled,
    } }
  }
  if (value.type === 'attemptFirstTouch') {
    if (Object.keys(value).some((k) => !FIRST_TOUCH_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim()) {
      return { reason: 'Invalid first-touch attempt', commandId }
    }
    return { request: {
      commandId, teamId: value.teamId, type: 'attemptFirstTouch',
      playerId: value.playerId,
    } }
  }
  if (value.type === 'attemptThrowIn') {
    const point = value.target
    if (Object.keys(value).some(k => !THROW_IN_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        !point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).some(k => k !== 'xM' && k !== 'yM') ||
        !insidePitch(point as Point2, pitch) ||
        typeof value.power !== 'number' || !Number.isFinite(value.power) ||
        value.power < .05 || value.power > 1) {
      return { reason: 'Invalid touchline throw-in request', commandId }
    }
    return { request: {
      commandId, teamId: value.teamId, type: 'attemptThrowIn',
      playerId: value.playerId,
      target: { ...(point as Point2) }, power: value.power,
    } }
  }
  if (value.type === 'attemptGoalkeeperThrow') {
    const point = value.target
    if (Object.keys(value).some(k => !THROW_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        !point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).some(k => k !== 'xM' && k !== 'yM') ||
        !insidePitch(point as Point2, pitch) ||
        typeof value.power !== 'number' || !Number.isFinite(value.power) ||
        value.power < .05 || value.power > 1) {
      return { reason: 'Invalid goalkeeper throw attempt', commandId }
    }
    const p = point as Point2
    return { request: {
      commandId, teamId: value.teamId, type: 'attemptGoalkeeperThrow',
      playerId: value.playerId, target: { xM: p.xM, yM: p.yM },
      power: value.power,
    } }
  }
  if (value.type === 'attemptCornerKick') {
    const point = value.target
    if (Object.keys(value).some(k => !CORNER_KICK_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        !point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).some(k => k !== 'xM' && k !== 'yM') ||
        !insidePitch(point as Point2, pitch) ||
        typeof value.power !== 'number' || !Number.isFinite(value.power) ||
        value.power < .05 || value.power > 1 ||
        typeof value.lift !== 'number' || !Number.isFinite(value.lift) ||
        value.lift < 0 || value.lift > 1) {
      return { reason: 'Invalid corner-kick request', commandId }
    }
    const p = point as Point2
    return { request: {
      commandId, teamId: value.teamId, type: 'attemptCornerKick',
      playerId: value.playerId,
      target: { xM: p.xM, yM: p.yM },
      power: value.power, lift: value.lift,
    } }
  }
  if (value.type === 'attemptGoalKick') {
    const point = value.target
    if (Object.keys(value).some(k => !GOAL_KICK_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        !point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).some(k => k !== 'xM' && k !== 'yM') ||
        !insidePitch(point as Point2, pitch) ||
        typeof value.power !== 'number' || !Number.isFinite(value.power) ||
        value.power < .05 || value.power > 1 ||
        typeof value.lift !== 'number' || !Number.isFinite(value.lift) ||
        value.lift < 0 || value.lift > 1) {
      return { reason: 'Invalid physical goal-kick request', commandId }
    }
    const p = point as Point2
    return { request: {
      commandId, teamId: value.teamId, type: 'attemptGoalKick',
      playerId: value.playerId,
      target: { xM: p.xM, yM: p.yM },
      power: value.power, lift: value.lift,
    } }
  }
  if (value.type === 'attemptKick') {
    const point = value.target
    if (Object.keys(value).some((k) => !KICK_FIELDS.includes(k)) ||
        typeof value.playerId !== 'string' || !value.playerId.trim() ||
        !point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).some((k) => k !== 'xM' && k !== 'yM') ||
        !insidePitch(point as Point2, pitch) ||
        typeof value.power !== 'number' || !Number.isFinite(value.power) ||
        value.power < 0.05 || value.power > 1 ||
        typeof value.lift !== 'number' || !Number.isFinite(value.lift) ||
        value.lift < 0 || value.lift > 1) {
      return { reason: 'Invalid kick attempt', commandId }
    }
    const p = point as Point2
    return { request: {
      commandId, teamId: value.teamId, type: 'attemptKick',
      playerId: value.playerId,
      target: { xM: p.xM, yM: p.yM },
      power: value.power,
      lift: value.lift,
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
  if ((req.type === 'setMovementTarget' ||
       req.type === 'attemptFirstTouch' || req.type === 'attemptKick' ||
       req.type === 'attemptGoalkeeperThrow' ||
       req.type === 'attemptThrowIn' ||
       req.type === 'attemptGoalKick' ||
       req.type === 'attemptCornerKick' ||
       req.type === 'setBallEngagement') &&
      !state.players.some((p) => p.playerId === req.playerId && p.clubId === req.teamId)) {
    return reject('Player does not belong to the specified team')
  }
  const restart = state.restart
  if (state.period === 'fullTime' || state.period === 'halfTime') {
    if (!['setAutonomousTeam','setPressingIntensity'].includes(req.type)) {
      return reject('Referee has stopped play at half-time or full-time')
    }
  }
  const secondHalf = state.periodKickoff
  const secondHalfPrefix = secondHalf
    ? 'ai-pass-secondhalf-' + secondHalf.startTick + '-' : null
  if (secondHalf && (
    ['attemptFirstTouch','attemptGoalkeeperThrow','diagnosticBallLaunch',
      'attemptThrowIn','attemptGoalKick','attemptCornerKick'].includes(req.type) ||
    (req.type === 'attemptKick' &&
      (secondHalf.phase !== 'staging' ||
       !secondHalfPrefix || !req.commandId.startsWith(secondHalfPrefix) ||
       req.teamId !== secondHalf.teamId ||
       req.playerId !== secondHalf.kickerId ||
       req.power !== .19 || req.lift !== 0))
  )) return reject('Only the legal second-half kickoff may restart football')
  if (req.type === 'attemptKick' &&
      req.commandId.startsWith('ai-pass-secondhalf-') &&
      (!secondHalfPrefix || !req.commandId.startsWith(secondHalfPrefix))) {
    return reject('No second-half referee kickoff award')
  }
  const postGoal = state.postGoalKickoff
  const postGoalPrefix = postGoal
    ? 'ai-pass-postgoal-' + postGoal.goalTick + '-' : null
  if (req.type === 'attemptKick' &&
      req.commandId.startsWith('ai-pass-postgoal-') &&
      (!postGoalPrefix || !req.commandId.startsWith(postGoalPrefix))) {
    return reject('No recorded scored goal authorizes this centre kick')
  }
  if (postGoal && (
    ['attemptFirstTouch', 'attemptGoalkeeperThrow', 'diagnosticBallLaunch',
      'attemptThrowIn', 'attemptGoalKick', 'attemptCornerKick'].includes(req.type) ||
    (req.type === 'attemptKick' &&
      (postGoal.phase !== 'staging' ||
       !postGoalPrefix || !req.commandId.startsWith(postGoalPrefix) ||
       req.teamId !== postGoal.teamId ||
       req.playerId !== postGoal.kickerId ||
       req.power !== .19 || req.lift !== 0))
  )) return reject('Only the awarded physical centre kick is allowed after a goal')
  const offside=state.offsideRestart
  const offsidePrefix=offside ? 'ai-pass-offside-'+offside.tick+'-' : null
  if (req.type==='attemptKick' &&
      req.commandId.startsWith('ai-pass-offside-') &&
      (!offsidePrefix || !req.commandId.startsWith(offsidePrefix))) {
    return reject('No legal offside indirect free-kick award')
  }
  if (offside && (
    ['attemptFirstTouch','attemptGoalkeeperThrow','diagnosticBallLaunch',
      'attemptThrowIn','attemptGoalKick','attemptCornerKick'].includes(req.type) ||
    (req.type==='attemptKick' &&
      (!offsidePrefix || !req.commandId.startsWith(offsidePrefix) ||
       req.teamId!==offside.awardedTeamId ||
       req.playerId!==offside.takerId ||
       req.power!==.34 || req.lift!==0))
  )) return reject('Only the awarded indirect free kick may restart play')
  // During a dead-ball stoppage, a regular touch/kick cannot secretly
  // bypass the authorized restart. Tactical commands can still be queued.
  if (restart && ['attemptKick', 'attemptFirstTouch',
    'attemptGoalkeeperThrow', 'diagnosticBallLaunch'].includes(req.type)) {
    return reject('Ball is dead until the awarded restart is taken')
  }
  if (req.type === 'attemptCornerKick') {
    if (restart?.kind !== 'corner' ||
        restart.awardedTeamId !== req.teamId ||
        !state.players.some(p => p.playerId === req.playerId &&
          p.clubId === req.teamId && p.formationSlot !== 'GK')) {
      return reject('Corner kick not authorized for this team and taker')
    }
    if (Math.hypot(req.target.xM - state.ball.position.xM,
      req.target.yM - state.ball.position.yM) < 4) {
      return reject('Corner kick target is not a meaningful field delivery')
    }
  }
  if (req.type === 'attemptGoalKick') {
    if (restart?.kind !== 'goalKick' ||
        restart.awardedTeamId !== req.teamId ||
        !state.players.some(p => p.playerId === req.playerId &&
          p.clubId === req.teamId && p.formationSlot === 'GK')) {
      return reject('Goal kick is not authorized for this goalkeeper')
    }
    const goalX = restart.side === 'left' ? 0 : pitch.lengthM
    const direction = restart.side === 'left' ? 1 : -1
    const projectedForward = (req.target.xM - goalX) * direction
    if (projectedForward <= pitch.goalAreaDepthM + 2 ||
        Math.hypot(req.target.xM - state.ball.position.xM,
          req.target.yM - state.ball.position.yM) < 5) {
      return reject('Goal kick must be directed into the field')
    }
  }
  if (req.type === 'attemptThrowIn') {
    const restart = state.restart
    if (!restart || restart.kind !== 'throwIn' ||
        restart.awardedTeamId !== req.teamId ||
        restart.takerId !== req.playerId ||
        Math.hypot(req.target.xM - restart.spot.xM,
          req.target.yM - restart.spot.yM) < 2.5 ||
        Math.hypot(req.target.xM - restart.spot.xM,
          req.target.yM - restart.spot.yM) > 28) {
      return reject('Throw-in is not authorized by a live touchline award')
    }
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
  let ai = state.ai
  for (const command of due) {
    if (command.type === 'setPressingIntensity') {
      teams = teams.map((team) => team.clubId === command.teamId
        ? { ...team, pressingIntensity: command.intensity }
        : team) as unknown as typeof teams
    } else if (command.type === 'setAutonomousTeam') {
      const index = teams.findIndex(t => t.clubId === command.teamId)
      if (index === -1) throw new Error('Missing team for autonomy')
      const enabledTeams: [boolean, boolean] = [...ai.enabledTeams]
      enabledTeams[index] = command.enabled
      ai = {
        ...ai, enabledTeams,
        decisionSnapshot: command.enabled ? ai.decisionSnapshot :
          ai.decisionSnapshot.filter(d => d.clubId !== command.teamId),
      }
      if (!command.enabled) {
        // A disabled team must no longer automatically contest the ball.
        // Existing movement momentum remains handled by locomotion.
        players = players.map(p => p.clubId === command.teamId
          ? { ...p, engagesBall: false } : p)
      }
    } else if (command.type === 'setMovementTarget') {
      players = players.map((p) => p.playerId === command.playerId
        ? { ...p, intention: { kind: 'moveToPoint' as const,
          sinceTick: state.clock.tick, target: { ...command.target } } }
        : p)
    } else if (command.type === 'setBallEngagement') {
      players = players.map(p => p.playerId === command.playerId
        ? { ...p, engagesBall: command.enabled }
        : p)
    } else if (command.type === 'diagnosticBallLaunch') {
      ball = launchDiagnosticBall(ball, command.velocity)
    }
    // Contact requests are recorded here and resolved AFTER physics. They do
    // not forge a touch when scheduled or when a player is out of reach.
  }
  const applied: AppliedMatchCommand[] = due.map((command) => ({
    ...command, appliedTick: state.clock.tick,
  }))
  const ids = new Set(due.map((command) => command.commandId))
  return {
    ...state, teams, players, ball, ai,
    pendingCommands: state.pendingCommands.filter((command) => !ids.has(command.commandId)),
    appliedCommands: [...state.appliedCommands, ...applied],
  }
}
