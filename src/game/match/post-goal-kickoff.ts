import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  GoalEvent, MatchState, PlayerMatchState, PostGoalKickoffState,
} from './state'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { advanceBallPhysics, BALL_RADIUS_M } from '../physics/ball'
import { scheduleMatchCommand } from './commands'
import { KICKOFF_CLEAR_MOVEMENT_M, KICKOFF_OPPONENT_CLEARANCE_M } from './kickoff'

/**
 * S1.4 — a separate Law 8 post-goal kick-off.
 *
 * Opening kick-off remains untouched. Each genuine new goal awards the
 * OTHER team a new centre restart. All players run, rather than teleport,
 * into their legal halves. Only a physical scheduled kick and subsequent
 * ball displacement return to normal AI/physics.
 */
export const POST_GOAL_KICKOFF_VERSION = 'after-goal-law8-physical-s14-v1'
const centre = (setup: MatchSetup): Point2 => ({
  xM: setup.pitch.lengthM / 2,
  yM: setup.pitch.widthM / 2,
})
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)
const speed = (p: PlayerMatchState) =>
  Math.hypot(p.velocity.xMps, p.velocity.yMps)
const MIN_GOAL_RESTART_DELAY_TICKS = 22

/** Pure stable taker/recipient selection from the real teamsheet. */
export function postGoalKickoffAward(
  after: MatchState, setup: MatchSetup, goal: GoalEvent,
): PostGoalKickoffState {
  const team = after.teams.find(t => t.clubId !== goal.scoringTeamId)
  if (!team) throw new Error('Goal has no conceding team')
  const kicker = after.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'ST')
  const receivers = after.players.filter(p =>
    p.clubId === team.clubId &&
    (p.formationSlot === 'RCM' || p.formationSlot === 'LCM'))
    .map(player => {
      const def = setup.players.find(p => p.id === player.playerId)
      if (!def) throw new Error('Goal restart midfielder lacks attributes')
      return {
        player,
        quality: .47 * def.abilities.technical.firstTouch +
          .28 * def.abilities.technical.technique +
          .25 * def.abilities.mental.anticipation,
      }
    })
    .sort((a, b) => b.quality - a.quality ||
      a.player.playerId.localeCompare(b.player.playerId))
  if (!kicker || !receivers.length)
    throw new Error('Conceding team lacks a real kick-off striker/receiver')
  return {
    goalTick: goal.tick,
    teamId: team.clubId,
    kickerId: kicker.playerId,
    receiverId: receivers[0].player.playerId,
    phase: 'staging',
    kickedTick: null,
  }
}

/** Same team physical formation anchors as kickoff, now measured for
 * whichever side conceded. Never reposition by resetting coordinates.
 */
export function postGoalKickoffTarget(
  state: MatchState, setup: MatchSetup, restart: PostGoalKickoffState,
  player: PlayerMatchState,
): Point2 {
  const c = centre(setup)
  const team = state.teams.find(t => t.clubId === player.clubId)
  if (!team) throw new Error('Missing goal-restart participant team')
  const own = -team.attackingDirection
  if (player.playerId === restart.kickerId) return {
    xM: c.xM + own * .74, yM: c.yM,
  }
  if (player.clubId === restart.teamId &&
      (player.formationSlot === 'RCM' ||
        player.formationSlot === 'LCM')) return {
    xM: c.xM + own * 5.9,
    yM: c.yM + (player.formationSlot === 'RCM' ? 3.7 : -3.7),
  }
  const anchor = state.ai.formationPositions[player.playerId] ??
    player.position
  const clearance = player.clubId === restart.teamId
    ? 1.55 : KICKOFF_OPPONENT_CLEARANCE_M
  return {
    xM: own === -1
      ? Math.min(anchor.xM, c.xM - clearance)
      : Math.max(anchor.xM, c.xM + clearance),
    yM: anchor.yM,
  }
}

export function postGoalKickoffPlayersLegal(
  state: MatchState, setup: MatchSetup,
  restart: PostGoalKickoffState,
): boolean {
  const c = centre(setup)
  return state.players.every(p => {
    const team = state.teams.find(t => t.clubId === p.clubId)
    if (!team) return false
    const own = -team.attackingDirection
    if (p.playerId === restart.kickerId) {
      return distance(p.position, c) <= .96 && speed(p) <= 1.7
    }
    // The kicker alone may enter the opposition half, per Law 8.
    if ((p.position.xM - c.xM) * own < -1e-7) return false
    if (p.clubId !== restart.teamId &&
        distance(p.position, c) < 9.15 - .005) return false
    return true
  })
}

/** The command identity is tied to the chronological goal plus the stable
 * sequence; a failed physical attempt may be retried without duplicating a
 * successful kick or altering the scorer's recorded goal.
 */
export function postGoalKickoffCommandPrefix(goalTick: number): string {
  return 'ai-pass-postgoal-' + goalTick + '-'
}

export function stagePostGoalKickoff(
  state: MatchState, setup: MatchSetup,
): MatchState {
  const restart = state.postGoalKickoff
  if (!restart || restart.phase !== 'staging') return state
  const teamIndex = state.teams.findIndex(t => t.clubId === restart.teamId)
  if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return state

  const playerTargets = new Map(state.players.map(p =>
    [p.playerId, postGoalKickoffTarget(state, setup, restart, p)]))
  const players = state.players.map(p => {
    const index = state.teams.findIndex(t => t.clubId === p.clubId)
    if (index < 0 || !state.ai.enabledTeams[index]) return p
    const target = playerTargets.get(p.playerId)!
    const previous = p.intention
    const same = previous.kind === 'moveToPoint' &&
      distance(previous.target, target) <= .16
    return {
      ...p, engagesBall: false,
      intention: same ? previous : {
        kind: 'moveToPoint' as const,
        sinceTick: state.clock.tick, target: { ...target },
      },
    }
  })
  let staged: MatchState = {
    ...state, players,
    ai: { ...state.ai, decisionSnapshot: [] },
  }
  const taker = state.players.find(p => p.playerId === restart.kickerId)
  const receiver = state.players.find(p => p.playerId === restart.receiverId)
  if (!taker || !receiver) throw new Error('Missing post-goal kickoff players')
  if (!postGoalKickoffPlayersLegal(state, setup, restart) ||
      distance(receiver.position, playerTargets.get(receiver.playerId)!) > 2.5 ||
      state.clock.tick - restart.goalTick < MIN_GOAL_RESTART_DELAY_TICKS)
    return staged

  const prefix = postGoalKickoffCommandPrefix(restart.goalTick)
  if (state.pendingCommands.some(c => c.type === 'attemptKick' &&
      c.commandId.startsWith(prefix))) return staged
  const prior = [...state.appliedCommands].reverse().find(c =>
    c.type === 'attemptKick' && c.commandId.startsWith(prefix))
  const priorResult = prior && state.contactEvents.find(e =>
    e.commandId === prior.commandId)
  if (prior && (priorResult?.outcome === 'kicked' ||
      state.clock.tick - prior.appliedTick < 8)) return staged

  const commandId = prefix + state.nextCommandSequence
  const receipt = scheduleMatchCommand(staged, {
    commandId, type: 'attemptKick', teamId: restart.teamId,
    playerId: restart.kickerId,
    target: { ...receiver.position },
    power: .19, lift: 0,
  }, setup.pitch)
  if (!receipt.receipt.accepted) throw new Error(
    'Could not schedule physical post-goal kickoff: ' +
      receipt.receipt.reason)
  staged = {
    ...receipt.state,
    ai: {
      ...receipt.state.ai,
      lastPassTick: state.clock.tick,
      passIntent: {
        commandId, teamId: restart.teamId,
        passerId: restart.kickerId,
        receiverId: restart.receiverId,
        requestedTick: state.clock.tick,
        target: { ...receiver.position },
      },
    },
  }
  return staged
}

/** Waiting for physical ball displacement after the kick is deliberate:
 * registering a kick command or a velocity alone cannot start play.
 */
export function advancePostGoalKickoff(
  state: MatchState, setup: MatchSetup,
  resolveContact: (state: MatchState, setup: MatchSetup) => MatchState,
): MatchState {
  const restart = state.postGoalKickoff
  if (!restart) return state
  if (restart.phase === 'awaitingMovement') {
    const ball = advanceBallPhysics(state.ball, setup.pitch)
    const moved: MatchState = { ...state, ball }
    if (distance(ball.position, centre(setup)) >= KICKOFF_CLEAR_MOVEMENT_M)
      return { ...moved, postGoalKickoff: null }
    return moved
  }
  const prepared = stagePostGoalKickoff(state, setup)
  const players = advancePlayerLocomotion(
    prepared, setup.players, setup.pitch)
  const contacted = resolveContact(players, setup)
  const last = contacted.contactEvents.at(-1)
  if (last?.tick !== state.clock.tick || last.outcome !== 'kicked' ||
      !last.commandId.startsWith(
        postGoalKickoffCommandPrefix(restart.goalTick))) return contacted
  return {
    ...contacted,
    postGoalKickoff: {
      ...restart, phase: 'awaitingMovement', kickedTick: state.clock.tick,
    },
  }
}

/** During staging the dead ball must remain on the centre mark. */
export function postGoalKickoffBallStationary(
  state: MatchState, setup: MatchSetup,
): boolean {
  const ball = state.ball
  const c = centre(setup)
  return !ball.outsidePitch && ball.controllerId === null &&
    ball.heightM === BALL_RADIUS_M &&
    ball.velocity.xMps === 0 && ball.velocity.yMps === 0 &&
    ball.velocity.zMps === 0 &&
    distance(ball.position, c) <= 1e-7
}
