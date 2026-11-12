import type { MatchState } from '../match/state'
import type { MatchSetup } from '../model/match'
import { MAX_COMMANDS_PER_MATCH, scheduleMatchCommand } from '../match/commands'
import { maintainPassReception } from './pass-coordination'
import { followMovingLooseBall } from './loose-ball'
import { trackGoalkeeperSaves } from './goal-directed'
import { chooseGoalkeeperThrow } from './goalkeeper-distribution'
import { activeGoalkeeperCatch } from '../physics/goalkeeper-handling'
import { canReleaseControlledBall, evaluateOnBallChoice } from './possession'
import { FOOT_CONTACT_MAX_HEIGHT_M, FOOT_REACH_M } from '../physics/contact'
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
  const current = trackGoalkeeperSaves(maintainPassReception(
    followMovingLooseBall(state, setup), setup), setup)
  if (!current.ai.enabledTeams.some(Boolean)) return current
  // A real kick, interception, deflection or challenge invalidates the
  // prior tactical phase immediately. Do not wait 0.6s for another decision.
  const latestContactTick = Math.max(
    current.contactEvents.at(-1)?.tick ?? -1,
    current.automaticContactEvents.at(-1)?.tick ?? -1,
  )
  // Receiver handoff/expired intent is itself a tactical event. The old
  // receiver must stop chasing and the new recovery player must engage now,
  // even between the usual 12-tick team planning cycles.
  const receptionReleased = state.ai.passIntent !== null &&
    current.ai.passIntent === null
  // Previously, repeated HELD OFF contact spam accidentally made carriers
  // replan every six ticks. Replace that dependency with a REAL geometric
  // pressure signal: a defender in imminent tackle range gets a promptly
  // reconsidered pass/carry/shot, without needing a fake new collision.
  const pressureOwner = current.ball.heightM <= FOOT_CONTACT_MAX_HEIGHT_M
    ? current.players.find(p =>
      p.playerId === current.ball.controllerId && p.formationSlot !== 'GK')
    : undefined
  const imminentPressure = !!pressureOwner && current.players.some(p =>
    p.clubId !== pressureOwner.clubId &&
    p.formationSlot !== 'GK' &&
    Math.hypot(p.position.xM - pressureOwner.position.xM,
      p.position.yM - pressureOwner.position.yM) < FOOT_REACH_M + 1.5)
  const decisionPeriod = imminentPressure
    ? Math.max(6, AI_DECISION_PERIOD_TICKS / 2)
    : AI_DECISION_PERIOD_TICKS
  if (current.ai.lastDecisionTick >= 0 &&
      current.clock.tick - current.ai.lastDecisionTick < decisionPeriod &&
      latestContactTick <= current.ai.lastDecisionTick &&
      !receptionReleased) {
    return current
  }
  // Evaluate movement intent and kick release on the SAME physical world
  // snapshot. Re-evaluating after writing tactical intentions could change
  // the selected action despite no new physical event.
  const owner = current.players.find(p =>
    p.playerId === current.ball.controllerId)
  const index = current.teams.findIndex(t => t.clubId === owner?.clubId)
  const ownerActive = owner && index >= 0 && current.ai.enabledTeams[index]
  const holding = activeGoalkeeperCatch(current) !== null
  const choice = ownerActive && !holding
    ? evaluateOnBallChoice(current, setup,
      canReleaseControlledBall(current, setup), true)
    : null
  const attempt = ownerActive && holding
    ? chooseGoalkeeperThrow(current, setup)
    : choosePossessionRelease(current, setup, choice)
  const snapshot = planTeamDecisions(current, setup, choice)
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
  const alreadyPending = result.pendingCommands.some(c =>
    (c.type === 'attemptKick' || c.type === 'attemptGoalkeeperThrow') &&
    (c.commandId.startsWith('ai-pass-') ||
      c.commandId.startsWith('ai-shot-')))
  if (attempt && !alreadyPending &&
      result.nextCommandSequence <= MAX_COMMANDS_PER_MATCH) {
    // The physical contact and goalkeeper systems recognize ai-shot-;
    // 'shoot' is the decision enum, not the command namespace.
    const commandId = (attempt.kind === 'shoot' ? 'ai-shot-' :
      attempt.kind === 'throw' ? 'ai-pass-throw-' : 'ai-pass-') +
      result.clock.tick + '-' + attempt.playerId
    const command = attempt.kind === 'throw' ? {
      commandId, type: 'attemptGoalkeeperThrow' as const,
      teamId: attempt.teamId, playerId: attempt.playerId,
      target: attempt.target, power: attempt.power,
    } : {
      commandId, type: 'attemptKick' as const,
      teamId: attempt.teamId, playerId: attempt.playerId,
      target: attempt.target, power: attempt.power, lift: attempt.lift,
    }
    const receipt = scheduleMatchCommand(result, command, setup.pitch)
    if (receipt.receipt.accepted) {
      result = maintainPassReception({
        ...receipt.state,
        ai: {
          ...result.ai,
          lastPassTick: result.clock.tick,
          passIntent: (attempt.kind === 'pass' || attempt.kind === 'throw') && attempt.receiverId
            ? {
              commandId, teamId: attempt.teamId,
              passerId: attempt.playerId,
              receiverId: attempt.receiverId,
              requestedTick: result.clock.tick,
              target: { ...attempt.target },
            } : null,
        },
      }, setup)
    }
  }
  return result
}
