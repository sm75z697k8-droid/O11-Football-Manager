import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PeriodKickoffState, PlayerMatchState } from './state'
import { FIXED_STEP_MILLISECONDS } from '../core/clock'
import { BALL_RADIUS_M, advanceBallPhysics } from '../physics/ball'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { openingKickoffState, KICKOFF_CLEAR_MOVEMENT_M, KICKOFF_OPPONENT_CLEARANCE_M } from './kickoff'
import { scheduleMatchCommand } from './commands'

/** Law 7: two actual 45-minute match periods; all timings derive ONLY
 * from authoritative 50ms simulated ticks. No short mock halves in game.
 * The estimated added-time policy is intentionally separate from football
 * laws and must be calibrated once realistic foul/injury stops are added.
 */
export const PERIOD_RULES_VERSION = 'two-halves-added-time-s15-v1'
export const HALF_MINUTES = 45
export const TICKS_PER_MINUTE = 60_000 / FIXED_STEP_MILLISECONDS
export const HALF_TICKS = HALF_MINUTES * TICKS_PER_MINUTE

const dist = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)
const speed = (p: PlayerMatchState) =>
  Math.hypot(p.velocity.xMps, p.velocity.yMps)
const centre = (setup: MatchSetup): Point2 => ({
  xM: setup.pitch.lengthM / 2, yM: setup.pitch.widthM / 2,
})

/** Whistle-driven periods start ONLY once a physical centre kick moves. */
export function startFirstHalfAfterOpening(state: MatchState): MatchState {
  if (state.period !== 'notStarted' ||
      state.kickoff?.phase !== 'inPlay' ||
      state.periodTiming.firstHalfStartTick !== null) return state
  return {
    ...state, period: 'firstHalf',
    periodTiming: {
      ...state.periodTiming,
      firstHalfStartTick: state.clock.tick,
    },
  }
}

function deadBallTime(state: MatchState): boolean {
  return state.restart !== null || state.postGoalKickoff !== null ||
    state.periodKickoff !== null
}

/** One authoritative timekeeping update per FULL simulated tick.
 * At 45:00 and 90:00 record a MINIMUM full-minute allowance from the
 * actual time spent on legal restarts and goal celebrations, then play
 * the allowance. It is frozen once announced (never shortened).
 */
export function adjudicatePeriodTime(state: MatchState): MatchState {
  if (state.period !== 'firstHalf' && state.period !== 'secondHalf')
    return state
  const first = state.period === 'firstHalf'
  const start = first
    ? state.periodTiming.firstHalfStartTick
    : state.periodTiming.secondHalfStartTick
  if (start === null) return state
  const priorLost = first
    ? state.periodTiming.firstHalfLostTicks
    : state.periodTiming.secondHalfLostTicks
  const lost = priorLost + (deadBallTime(state) ? 1 : 0)
  const existingAdded = first
    ? state.periodTiming.firstHalfAddedTicks
    : state.periodTiming.secondHalfAddedTicks
  const elapsed = state.clock.tick - start
  const added = elapsed >= HALF_TICKS && existingAdded === null
    ? Math.ceil(lost / TICKS_PER_MINUTE) * TICKS_PER_MINUTE
    : existingAdded
  const timing = {
    ...state.periodTiming,
    ...(first
      ? { firstHalfLostTicks: lost, firstHalfAddedTicks: added }
      : { secondHalfLostTicks: lost, secondHalfAddedTicks: added }),
  }
  if (elapsed < HALF_TICKS + (added ?? 0)) {
    return { ...state, periodTiming: timing }
  }
  const ended = first ? 'halfTime' : 'fullTime'
  return {
    ...state,
    period: ended,
    periodTiming: first
      ? { ...timing, halfTimeTick: state.clock.tick }
      : { ...timing, fullTimeTick: state.clock.tick },
    ai: {
      ...state.ai, passIntent: null, decisionSnapshot: [],
    },
  }
}

export function periodKickoffPrefix(tick: number): string {
  return 'ai-pass-secondhalf-' + tick + '-'
}

function secondHalfTeam(state: MatchState, setup: MatchSetup) {
  const original = setup.kickoff?.teamId
  if (!original) throw new Error('Second-half kickoff requires a real opening kickoff')
  const opponent = state.teams.find(t => t.clubId !== original)
  if (!opponent) throw new Error('Second-half taking team is missing')
  return opponent
}

/** Halftime is a real interruption: all players return from the interval
 * already legally positioned for the second-half kickoff. This is NOT
 * player teleportation during open play. Energy and scores persist.
 */
export function prepareSecondHalf(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (state.period !== 'halfTime' ||
      state.periodTiming.halfTimeTick !== state.clock.tick) {
    throw new Error('Second half can only start from actual halftime')
  }
  const taking = secondHalfTeam(state, setup)
  const definition = openingKickoffState({
    ...setup, kickoff: { teamId: taking.clubId },
  })
  if (!definition) throw new Error('Could not select second-half kickoff')
  const flippedTeams = state.teams.map(team => ({
    ...team, attackingDirection: -team.attackingDirection as 1 | -1,
  })) as unknown as MatchState['teams']
  const anchors = Object.fromEntries(
    Object.entries(state.ai.formationPositions).map(([id, p]) =>
      [id, {xM: setup.pitch.lengthM - p.xM, yM: setup.pitch.widthM - p.yM}]),
  ) as Record<string, Point2>
  const restart: PeriodKickoffState = {
    startTick: state.clock.tick,
    teamId: definition.teamId,
    kickerId: definition.kickerId,
    receiverId: definition.receiverId,
    phase: 'staging',
    kickedTick: null,
  }
  const temporary: MatchState = {
    ...state,
    teams: flippedTeams, period: 'secondHalf',
    periodKickoff: restart,
    restart: null, postGoalKickoff: null,
    ai: {
      ...state.ai, formationPositions: anchors,
      passIntent: null, decisionSnapshot: [],
    },
  }
  const players = temporary.players.map(p => ({
    ...p,
    position: secondHalfKickoffTarget(temporary, setup, restart, p),
    velocity: {xMps:0,yMps:0},
    orientationRad: flippedTeams.find(t => t.clubId === p.clubId)!
      .attackingDirection === 1 ? 0 : Math.PI,
    engagesBall: false,
    intention: { kind: 'holdFormation' as const, sinceTick: state.clock.tick },
  }))
  return {
    ...temporary, players,
    ball: {
      ...state.ball,
      position: centre(setup), heightM: BALL_RADIUS_M,
      velocity: {xMps:0,yMps:0,zMps:0},
      outsidePitch: false, controllerId: null, controlOffset: null,
    },
  }
}

/** The striker alone is allowed close to the centre; all other players
 * remain in their own half and opponents are 9.15m away.
 */
export function secondHalfKickoffTarget(
  state: MatchState, setup: MatchSetup,
  restart: PeriodKickoffState, p: PlayerMatchState,
): Point2 {
  const c = centre(setup)
  const team = state.teams.find(t => t.clubId === p.clubId)
  if (!team) throw new Error('Missing halftime player team')
  const own = -team.attackingDirection
  if (p.playerId === restart.kickerId) {
    return {xM:c.xM + own * .77, yM:c.yM}
  }
  if (p.clubId === restart.teamId &&
      (p.formationSlot === 'RCM' || p.formationSlot === 'LCM')) {
    return {
      xM:c.xM + own * 5.8,
      yM:c.yM + (p.formationSlot === 'RCM' ? 3.5 : -3.5),
    }
  }
  const anchor = state.ai.formationPositions[p.playerId] ?? p.position
  const clearance = p.clubId === restart.teamId
    ? 1.8 : KICKOFF_OPPONENT_CLEARANCE_M
  return {
    xM:own < 0
      ? Math.min(anchor.xM, c.xM - clearance)
      : Math.max(anchor.xM, c.xM + clearance),
    yM:anchor.yM,
  }
}

export function secondHalfKickoffLegal(
  state: MatchState, setup: MatchSetup,
): boolean {
  const restart = state.periodKickoff
  if (!restart) return false
  const c = centre(setup)
  return state.players.every(p => {
    const team = state.teams.find(t => t.clubId === p.clubId)
    if (!team) return false
    const own = -team.attackingDirection
    if (p.playerId === restart.kickerId) {
      return dist(p.position, c) <= .97 && speed(p) <= 1.7
    }
    if ((p.position.xM - c.xM) * own < -1e-7) return false
    return p.clubId === restart.teamId ||
      dist(p.position, c) >= 9.15 - .005
  })
}

export function secondHalfKickoffBallStationary(
  state: MatchState, setup: MatchSetup,
): boolean {
  const b = state.ball
  return b.controllerId === null && !b.outsidePitch &&
    b.heightM === BALL_RADIUS_M &&
    b.velocity.xMps === 0 && b.velocity.yMps === 0 &&
    b.velocity.zMps === 0 &&
    dist(b.position, centre(setup)) <= 1e-7
}

export function advanceSecondHalfKickoff(
  state: MatchState, setup: MatchSetup,
  resolveContact: (s: MatchState, setup: MatchSetup) => MatchState,
): MatchState {
  const restart = state.periodKickoff
  if (!restart) return state
  if (restart.phase === 'awaitingMovement') {
    const ball = advanceBallPhysics(state.ball, setup.pitch)
    if (dist(ball.position, centre(setup)) < KICKOFF_CLEAR_MOVEMENT_M)
      return {...state, ball}
    return {
      ...state, ball, periodKickoff: null,
      periodTiming: {
        ...state.periodTiming, secondHalfStartTick: state.clock.tick,
      },
    }
  }

  const teamIndex = state.teams.findIndex(t => t.clubId === restart.teamId)
  if (teamIndex < 0) throw new Error('Second-half kickoff missing taking team')
  let prepared = state
  const contactPending = state.pendingCommands.some(c =>
    c.type === 'attemptKick' &&
    c.commandId.startsWith(periodKickoffPrefix(restart.startTick)))
  const contactDone = [...state.appliedCommands].reverse().find(c =>
    c.type === 'attemptKick' &&
    c.commandId.startsWith(periodKickoffPrefix(restart.startTick)))
  const lastResult = contactDone && state.contactEvents.find(e =>
    e.commandId === contactDone.commandId)
  const ready = secondHalfKickoffLegal(state, setup) &&
    secondHalfKickoffBallStationary(state, setup)
  const canRetry = !contactDone ||
    (lastResult?.outcome !== 'kicked' &&
      state.clock.tick - contactDone.appliedTick >= 8)
  if (ready && state.ai.enabledTeams[teamIndex] && canRetry &&
      !contactPending) {
    const receiver = state.players.find(p => p.playerId === restart.receiverId)
    if (!receiver) throw new Error('Second-half receiver is missing')
    const commandId = periodKickoffPrefix(restart.startTick) +
      state.nextCommandSequence
    const receipt = scheduleMatchCommand(state, {
      commandId, type:'attemptKick', teamId:restart.teamId,
      playerId:restart.kickerId,
      target:{...receiver.position}, power:.19, lift:0,
    }, setup.pitch)
    if (!receipt.receipt.accepted) throw new Error(
      'Could not schedule second-half centre kick: ' +
      receipt.receipt.reason)
    prepared = {
      ...receipt.state,
      ai: {
        ...receipt.state.ai, lastPassTick: state.clock.tick,
        passIntent: {
          commandId, teamId:restart.teamId,
          passerId:restart.kickerId, receiverId:restart.receiverId,
          target:{...receiver.position}, requestedTick:state.clock.tick,
        },
      },
    }
  }
  const moved = advancePlayerLocomotion(prepared, setup.players, setup.pitch)
  const contacted = resolveContact(moved, setup)
  const event = contacted.contactEvents.at(-1)
  if (!event || event.tick !== state.clock.tick ||
      event.outcome !== 'kicked' ||
      !event.commandId.startsWith(periodKickoffPrefix(restart.startTick)))
    return contacted
  return {
    ...contacted,
    periodKickoff: {
      ...restart, phase:'awaitingMovement',
      kickedTick:state.clock.tick,
    },
  }
}

/** Historical event timestamps remain correct after switching ends and
 * after added time; never reinterpret old first-half contacts as second-half.
 */
export function formatMatchEventTime(
  state: MatchState, tick: number,
): string {
  const boundary = state.periodTiming.halfTimeTick
  const afterBreak = boundary !== null && tick > boundary
  const started = afterBreak
    ? state.periodTiming.secondHalfStartTick
    : state.periodTiming.firstHalfStartTick
  const reference = started ?? (afterBreak ? boundary : 0)
  const elapsed = Math.max(0, tick-reference)
  const minute = Math.floor(elapsed/TICKS_PER_MINUTE)
  const second = Math.floor((elapsed%TICKS_PER_MINUTE) *
    FIXED_STEP_MILLISECONDS/1000)
  if (minute >= HALF_MINUTES) {
    return String(afterBreak ? 90 : 45) + '+' +
      String(minute-HALF_MINUTES+1) + ':' +
      String(second).padStart(2,'0')
  }
  return String((afterBreak?45:0)+minute).padStart(2,'0')+':' +
    String(second).padStart(2,'0')
}

/** Game-clock display, independent of the world/physics tick count. */
export function formatMatchTime(state: MatchState): string {
  if (state.period === 'notStarted') {
    // Physics-only legacy fixtures have no referee kickoff; keep their
    // historical diagnostic timer rather than misleadingly showing zero.
    if (!state.kickoff) {
      const seconds = Math.floor(state.clock.tick *
        FIXED_STEP_MILLISECONDS / 1000)
      return String(Math.floor(seconds / 60)).padStart(2,'0') +
        ':' + String(seconds % 60).padStart(2,'0')
    }
    return '00:00'
  }
  if (state.period === 'halfTime') {
    const allowance = state.periodTiming.firstHalfAddedTicks ?? 0
    return allowance > 0 ? 'HT · 45+' +
      String(allowance / TICKS_PER_MINUTE) : 'HT · 45:00'
  }
  if (state.period === 'fullTime') {
    const started = state.periodTiming.secondHalfStartTick
    const elapsed = started === null ? HALF_TICKS :
      state.clock.tick - started
    const extra = Math.max(0, elapsed - HALF_TICKS)
    return 'FT · ' + (extra === 0 ? '90:00' :
      '90+' + Math.ceil(extra / TICKS_PER_MINUTE))
  }
  const first = state.period === 'firstHalf'
  const start = first
    ? state.periodTiming.firstHalfStartTick
    : state.periodTiming.secondHalfStartTick
  if (start === null) return first ? '00:00' : '45:00'
  const elapsed = Math.max(0, state.clock.tick-start)
  const base = first ? 0 : HALF_MINUTES
  const minutes = Math.floor(elapsed/TICKS_PER_MINUTE)
  const seconds = Math.floor((elapsed%TICKS_PER_MINUTE) *
    FIXED_STEP_MILLISECONDS/1000)
  if (minutes >= HALF_MINUTES) {
    const limit = first ? 45 : 90
    if (minutes === HALF_MINUTES && seconds === 0)
      return String(limit) + ':00'
    return String(limit) + '+' + String(minutes-HALF_MINUTES+1) +
      ':' + String(seconds).padStart(2,'0')
  }
  return String(base+minutes).padStart(2,'0')+':' +
    String(seconds).padStart(2,'0')
}
