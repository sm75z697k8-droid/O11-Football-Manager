import type { MatchState } from '../match/state'
import { formatDiagnosticTime } from './pacing'

/** An explicitly user-requested copyable reproduction report.
 * No network request, browser identifiers, account data or device location.
 * Expensive full-history aggregates run only after the Copy button is tapped.
 */
export const MATCH_DIAGNOSTICS_VERSION = 'o11-debug-report-v1'

export function copyableMatchDiagnostics(state: MatchState): string {
  const lastKick = [...state.contactEvents].reverse().find(e =>
    e.outcome === 'kicked' || e.outcome === 'thrown')
  const player = state.players.find(p => p.playerId === state.ball.controllerId)
  const ball = state.ball
  return JSON.stringify({
    report: MATCH_DIAGNOSTICS_VERSION,
    engineVersion: state.engineVersion,
    seed: state.seed.toString(16).toUpperCase().padStart(8, '0'),
    time: formatDiagnosticTime(state.clock.tick),
    tick: state.clock.tick,
    terminal: ball.outsidePitch ? 'out-of-play'
      : state.goalEvents.length ? 'goal' : 'playing',
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
