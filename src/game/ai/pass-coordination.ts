import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, CoordinatedPassIntent, PlayerMatchState } from '../match/state'
import { boundedTarget, estimateInterception } from './coordination'

/** Small, bounded team-level pass intent. Never awards a reception.
 * It tells the actual intended player where to seek physical contact.
 */
export const PASS_INTENT_MAX_AGE_TICKS = 80

export function activePassIntent(state: MatchState): CoordinatedPassIntent | null {
  const intent = state.ai.passIntent
  if (!intent) return null
  const enabled = state.teams.findIndex(t => t.clubId === intent.teamId)
  if (enabled < 0 || !state.ai.enabledTeams[enabled] ||
      state.clock.tick > intent.requestedTick + PASS_INTENT_MAX_AGE_TICKS ||
      state.ball.outsidePitch) return null
  const contact = state.contactEvents.find(e => e.commandId === intent.commandId)
  if (contact && contact.outcome !== 'kicked') return null
  // A different player touching the ball, or a new controller, ends this
  // particular pass. Subsequent decisions can generate a different one.
  if (state.ball.controllerId !== null &&
      state.ball.controllerId !== intent.passerId) return null
  if (state.clock.tick > intent.requestedTick &&
      state.ball.lastTouchPlayerId !== null &&
      state.ball.lastTouchPlayerId !== intent.passerId) return null
  const receiver = state.players.find(p => p.playerId === intent.receiverId)
  if (!receiver || receiver.clubId !== intent.teamId) return null
  return intent
}

export function intendedReceiverTarget(
  state: MatchState, setup: MatchSetup,
  intent: CoordinatedPassIntent,
): Point2 {
  const receiver = state.players.find(p => p.playerId === intent.receiverId)
  const definition = setup.players.find(p => p.id === intent.receiverId)
  if (!receiver || !definition) throw new Error('Missing physically intended pass receiver')
  const hasKicked = state.contactEvents.some(e =>
    e.commandId === intent.commandId && e.outcome === 'kicked')
  if (!hasKicked || state.ball.controllerId !== null) {
    return boundedTarget(intent.target, setup.pitch)
  }
  const estimate = estimateInterception(receiver, definition, state.ball, setup.pitch)
  // The intended point remains a valid fallback if the recipient cannot
  // physically intercept the current ball flight in the first 3.2 seconds.
  return estimate?.target ?? boundedTarget(intent.target, setup.pitch)
}

function setReceiverIntention(
  player: PlayerMatchState, target: Point2, tick: number,
): PlayerMatchState {
  const previous = player.intention
  const same = previous.kind === 'moveToPoint' &&
    Math.hypot(previous.target.xM - target.xM,
      previous.target.yM - target.yM) < .2
  return {
    ...player,
    engagesBall: true,
    intention: same ? previous : {
      kind: 'moveToPoint', sinceTick: tick, target: { ...target },
    },
  }
}

/** Called every 50ms even when the full 22-agent planner is on its 12-tick
 * schedule, so short, fast passes do not outrun their intended receiver.
 */
export function maintainPassReception(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (!state.ai.passIntent) return state
  const intent = activePassIntent(state)
  if (!intent) {
    return { ...state, ai: { ...state.ai, passIntent: null } }
  }
  const target = intendedReceiverTarget(state, setup, intent)
  const players = state.players.map(p => p.playerId === intent.receiverId
    ? setReceiverIntention(p, target, state.clock.tick) : p)
  const decisionSnapshot = state.ai.decisionSnapshot.map(d =>
    d.playerId === intent.receiverId
      ? { ...d, action: 'receive' as const, engage: true, target } : d)
  return {
    ...state, players,
    ai: { ...state.ai, decisionSnapshot },
  }
}
