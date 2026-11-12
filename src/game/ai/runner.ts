import type { MatchState } from '../match/state'
import type { MatchSetup } from '../model/match'
import { MAX_COMMANDS_PER_MATCH, scheduleMatchCommand } from '../match/commands'
import {
  AI_DECISION_PERIOD_TICKS, choosePossessionRelease, planTeamDecisions,
} from './decisions'

/** A bounded decision snapshot and at most one attempted kick every cycle.
 * Existing match physics performs all actual motion and contact.
 */
export function runAutonomousDecisions(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (!state.ai.enabledTeams.some(Boolean)) return state
  if (state.ai.lastDecisionTick >= 0 &&
      state.clock.tick - state.ai.lastDecisionTick < AI_DECISION_PERIOD_TICKS) {
    return state
  }
  const snapshot = planTeamDecisions(state, setup)
  const byId = new Map(snapshot.map((decision) => [decision.playerId, decision]))
  const players = state.players.map(player => {
    const decision = byId.get(player.playerId)
    if (!decision) return player
    const previous = player.intention
    const unchanged = previous.kind === 'moveToPoint' &&
      Math.hypot(previous.target.xM - decision.target.xM,
        previous.target.yM - decision.target.yM) < 0.35
    return {
      ...player,
      engagesBall: decision.engage,
      intention: unchanged ? previous : {
        kind: 'moveToPoint' as const,
        sinceTick: state.clock.tick,
        target: { ...decision.target },
      },
    }
  })
  let result: MatchState = {
    ...state, players,
    ai: {
      ...state.ai,
      lastDecisionTick: state.clock.tick,
      decisionSnapshot: snapshot,
    },
  }
  const attempt = choosePossessionRelease(result, setup)
  const alreadyPending = result.pendingCommands.some(c =>
    c.type === 'attemptKick' && c.commandId.startsWith('ai-pass-'))
  if (attempt && !alreadyPending &&
      result.nextCommandSequence <= MAX_COMMANDS_PER_MATCH) {
    const receipt = scheduleMatchCommand(result, {
      commandId: 'ai-pass-' + result.clock.tick + '-' + attempt.playerId,
      type: 'attemptKick',
      teamId: attempt.teamId,
      playerId: attempt.playerId,
      target: attempt.target,
      power: attempt.power,
      lift: attempt.lift,
    }, setup.pitch)
    if (receipt.receipt.accepted) {
      result = {
        ...receipt.state,
        ai: { ...result.ai, lastPassTick: result.clock.tick },
      }
    }
  }
  return result
}
