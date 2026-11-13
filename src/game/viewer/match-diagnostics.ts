import type { MatchState } from '../match/state'
import { formatMatchTime } from '../match/periods'

/** An explicitly user-requested copyable reproduction report.
 * No network request, browser identifiers, account data or device location.
 * Expensive full-history aggregates run only after the Copy button is tapped.
 */
export const MATCH_DIAGNOSTICS_VERSION = 'o11-debug-report-v1'

export function copyableMatchDiagnostics(state: MatchState): string {
  const lastKick = [...state.contactEvents].reverse().find(e =>
    e.outcome === 'kicked' || e.outcome === 'thrown' ||
    e.outcome === 'thrownIn' || e.outcome === 'goalKicked' ||
    e.outcome === 'cornerKicked')
  const player = state.players.find(p => p.playerId === state.ball.controllerId)
  const ball = state.ball
  return JSON.stringify({
    report: MATCH_DIAGNOSTICS_VERSION,
    engineVersion: state.engineVersion,
    seed: state.seed.toString(16).toUpperCase().padStart(8, '0'),
    time: formatMatchTime(state),
    period: state.period,
    periodTiming: state.periodTiming,
    periodKickoff: state.periodKickoff,
    tick: state.clock.tick,
    terminal: state.period === 'fullTime' ? 'full-time' :
      state.period === 'halfTime' ? 'half-time' :
      state.periodKickoff ? 'second-half-' + state.periodKickoff.phase :
      state.postGoalKickoff
      ? 'post-goal-' + state.postGoalKickoff.phase :
      state.offsideRestart ? 'offside-indirect-free-kick' :
      state.restart?.kind === 'throwIn' ? 'throw-in-staging' :
        state.restart?.kind === 'goalKick' ? 'goal-kick-staging' :
        state.restart?.kind === 'corner' ? 'corner-staging' :
        ball.outsidePitch ? 'out-of-play' : 'playing',
    restart: state.restart,
    offsideRestart: state.offsideRestart,
    offsidePhase: state.offsidePhase,
    lastOffside: state.offsideEvents.at(-1) ?? null,
    offsides: state.offsideEvents.length,
    indirectFreeKick: state.indirectFreeKick,
    postGoalKickoff: state.postGoalKickoff,
    lastGoal: state.goalEvents.at(-1) ?? null,
    scoreboard: state.teams.map(t => ({
      clubId: t.clubId, goals: t.score,
    })),
    completedPostGoalKickoffs: state.contactEvents.filter(e =>
      e.outcome === 'kicked' &&
      e.commandId.startsWith('ai-pass-postgoal-')).length,
    outOfPlayCounts: {
      total: state.outOfPlayEvents.length,
      throwIns: state.outOfPlayEvents.filter(e => e.kind === 'throwIn').length,
      completedThrowIns: state.contactEvents.filter(
        e => e.outcome === 'thrownIn').length,
      goalKicks: state.outOfPlayEvents.filter(
        e => e.kind === 'goalKick').length,
      completedGoalKicks: state.contactEvents.filter(
        e => e.outcome === 'goalKicked').length,
      corners: state.outOfPlayEvents.filter(
        e => e.kind === 'corner').length,
      completedCorners: state.contactEvents.filter(
        e => e.outcome === 'cornerKicked').length,
    },
    aiTeams: state.ai.enabledTeams,
    commandsUsed: state.nextCommandSequence - 1,
    pendingCommands: state.pendingCommands.length,
    lastCommand: state.appliedCommands.at(-1) ?
      {
        id: state.appliedCommands.at(-1)!.commandId,
        tick: state.appliedCommands.at(-1)!.appliedTick,
      } : null,
    ball: {
      xM: Number(ball.position.xM.toFixed(3)),
      yM: Number(ball.position.yM.toFixed(3)),
      heightM: Number(ball.heightM.toFixed(3)),
      vx: Number(ball.velocity.xMps.toFixed(3)),
      vy: Number(ball.velocity.yMps.toFixed(3)),
      controller: player?.playerId ?? null,
      controllerTeam: player?.clubId ?? null,
      outsidePitch: ball.outsidePitch,
    },
    contactCounts: {
      attempted: state.contactEvents.length,
      automatic: state.automaticContactEvents.length,
    },
    lastPhysicalRelease: lastKick ?
      { tick: lastKick.tick, commandId: lastKick.commandId,
        playerId: lastKick.playerId, outcome: lastKick.outcome } : null,
    latestAutomaticContacts: state.automaticContactEvents.slice(-8).map(e =>
      ({ tick:e.tick, playerId:e.playerId, outcome:e.outcome })),
    lastAiDecisionTick: state.ai.lastDecisionTick,
    goals: state.goalEvents.length,
  }, null, 2)
}
