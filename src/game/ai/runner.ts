import type { MatchState } from '../match/state'
import type { MatchSetup } from '../model/match'
import { MAX_COMMANDS_PER_MATCH, scheduleMatchCommand } from '../match/commands'
import { maintainPassReception } from './pass-coordination'
import { followMovingLooseBall } from './loose-ball'
import {
  AI_DECISION_PERIOD_TICKS, choosePossessionRelease, planTeamDecisions,
} from './decisions'

/** A bounded decision snapshot and at most one attempted kick every cycle.
 * Existing match physics performs all actual motion and contact.
 */
export function runAutonomousDecisions(
  state: MatchState, setup: MatchSetup,
): MatchState {
  // Law 8: no autonomous chase or movement until the real opening kick
  // has clearly moved the stationary centre ball.
  if (state.kickoff?.phase === 'awaitingKick') return state
  const current = maintainPassReception(
    followMovingLooseBall(state, setup), setup)
  if (!current.ai.enabledTeams.some(Boolean)) return current
  // A real kick, interception, deflection or challenge invalidates the
  // prior tactical phase immediately. Do not wait 0.6s for another decision.
  const latestContactTick = Math.max(
    current.contactEvents.at(-1)?.tick ?? -1,
    current.automaticContactEvents.at(-1)?.tick ?? -1,
  )
  if (current.ai.lastDecisionTick >= 0 &&
      current.clock.tick - current.ai.lastDecisionTick < AI_DECISION_PERIOD_TICKS &&
      latestContactTick <= current.ai.lastDecisionTick) {
    return current
  }
  const snapshot = planTeamDecisions(current, setup)
  const byId = new Map(snapshot.map((decision) => [decision.playerId, decision]))
  const players = current.players.map(player => {
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
    ...current, players,
    ai: {
      ...current.ai,
      lastDecisionTick: current.clock.tick,
      decisionSnapshot: snapshot,
    },
  }
  const attempt = choosePossessionRelease(result, setup)
  const alreadyPending = result.pendingCommands.some(c =>
    c.type === 'attemptKick' && c.commandId.startsWith('ai-pass-'))
  if (attempt && !alreadyPending &&
      result.nextCommandSequence <= MAX_COMMANDS_PER_MATCH) {
    const commandId = 'ai-pass-' + result.clock.tick + '-' + attempt.playerId
    const receipt = scheduleMatchCommand(result, {
      commandId,
      type: 'attemptKick',
      teamId: attempt.teamId,
      playerId: attempt.playerId,
      target: attempt.target,
      power: attempt.power,
      lift: attempt.lift,
    }, setup.pitch)
    if (receipt.receipt.accepted) {
      result = maintainPassReception({
        ...receipt.state,
        ai: {
          ...result.ai,
          lastPassTick: result.clock.tick,
          passIntent: {
            commandId, teamId: attempt.teamId,
            passerId: attempt.playerId,
            receiverId: attempt.receiverId,
            requestedTick: result.clock.tick,
            target: { ...attempt.target },
          },
        },
      }, setup)
    }
  }
  return result
}
