import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, CoordinatedPassIntent, PlayerMatchState } from '../match/state'
import { estimatedRecoverySeconds } from './loose-ball'
import {
  boundedTarget, estimateInterception, predictBallAt,
} from './coordination'

/** Small, bounded team-level pass intent. Never awards a reception.
 * It tells the actual intended player where to seek physical contact.
 */
export const PASS_INTENT_MAX_AGE_TICKS = 80
/** Reassess live recovery only every 200 simulated milliseconds. */
export const PASS_RECOVERY_REVIEW_INTERVAL_TICKS = 4
/** Abandon only an unreachable receiver for a clearly faster chaser. */
export const PASS_RECOVERY_HANDOFF_MARGIN_S = 0.55

/**
 * A nominated receiver retains priority while a plausible intercept exists.
 * After the kick, a materially faster outfield teammate can take over a
 * missed/deflected pass. Both estimates use the existing physical
 * interception predictor; no contact or possession is fabricated.
 *
 * Pure and bounded: at most 10 prospective teammates every four ticks
 * while an actual kicked pass remains loose. Once released, normal team
 * recovery owns the decision rather than oscillating between receivers.
 */
export function shouldYieldPassReception(
  state: MatchState, setup: MatchSetup, intent: CoordinatedPassIntent,
): boolean {
  if (state.ball.controllerId !== null || state.ball.outsidePitch ||
      state.clock.tick - intent.requestedTick < PASS_RECOVERY_REVIEW_INTERVAL_TICKS ||
      state.clock.tick % PASS_RECOVERY_REVIEW_INTERVAL_TICKS !== 0 ||
      !state.contactEvents.some(e =>
        e.commandId === intent.commandId &&
    (e.outcome === 'kicked' || e.outcome === 'thrown'))) return false

  const original = state.players.find(p => p.playerId === intent.receiverId)
  if (!original) return false
  const definition = setup.players.find(p => p.id === intent.receiverId)
  if (!definition) throw new Error('Missing intended pass receiver definition')
  // A teammate being closer to the travelling ball does not invalidate an
  // intentional, still-reachable pass. Only replace the intended runner
  // if their own interception estimate has become physically implausible.
  if (estimateInterception(original, definition, state.ball, setup.pitch))
    return false
  const originalTime = estimatedRecoverySeconds(original, state, setup)
  return state.players.some(p => {
    if (p.clubId !== intent.teamId || p.formationSlot === 'GK' ||
        p.playerId === intent.receiverId || p.playerId === intent.passerId)
      return false
    // Opening taker must not be assigned the second touch before anybody
    // else contacts the ball (Law 8).
    if (state.kickoff?.phase === 'inPlay' &&
        p.playerId === state.kickoff.kickerId &&
        state.ball.lastTouchPlayerId === p.playerId) return false
    return estimatedRecoverySeconds(p, state, setup) + PASS_RECOVERY_HANDOFF_MARGIN_S < originalTime
  })
}

export function activePassIntent(state: MatchState): CoordinatedPassIntent | null {
  const intent = state.ai.passIntent
  if (!intent) return null
  const enabled = state.teams.findIndex(t => t.clubId === intent.teamId)
  if (enabled < 0 || !state.ai.enabledTeams[enabled] ||
      state.clock.tick > intent.requestedTick + PASS_INTENT_MAX_AGE_TICKS ||
      state.ball.outsidePitch) return null
  const contact = state.contactEvents.find(e => e.commandId === intent.commandId)
  if (contact && contact.outcome !== 'kicked' && contact.outcome !== 'thrown') return null
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
    e.commandId === intent.commandId &&
    (e.outcome === 'kicked' || e.outcome === 'thrown'))
  if (!hasKicked || state.ball.controllerId !== null) {
    return boundedTarget(intent.target, setup.pitch)
  }
  const estimate = estimateInterception(receiver, definition, state.ball, setup.pitch)
  // The intended point remains a valid fallback if the recipient cannot
  // physically intercept the current ball flight in the first 3.2 seconds.
  if (estimate) return estimate.target
  // After a real inaccurate kick, the original intended point may be
  // unreachable. Continue pursuing the actual rolling trajectory instead
  // of sprinting toward an empty, outdated meeting location.
  const projected = predictBallAt(state.ball, .55).position
  return boundedTarget(projected, setup.pitch)
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
  if (!intent || shouldYieldPassReception(state, setup, intent)) {
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
