import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

/** Informational Node benchmark only: NOT iPhone Safari FPS or a full match. */
describe('Phase 5 autonomous reasoning workload', () => {
  it('runs 22 simulated decision-makers with existing movement and ball physics', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    for (const club of ['club_harbor', 'club_vale']) {
      expect(engine.submitCommand({
        commandId: 'enable-' + club,
        teamId: club,
        type: 'setAutonomousTeam',
        enabled: true,
      }).accepted).toBe(true)
    }
    const start = performance.now()
    engine.advance(1000)
    const elapsed = performance.now() - start
    const state = engine.getState()
    const checkpoint = engine.checkpoint()
    expect(state.clock.tick).toBe(1000)
    expect(state.ai.enabledTeams).toEqual([true, true])
    expect(state.ai.decisionSnapshot).toHaveLength(22)
    expect(state.teams.map(t => t.score)).toEqual([0, 0])
    expect(restoreFoundationMatch(checkpoint).checkpoint()).toEqual(checkpoint)
    console.info('[O11 Phase 5 AI baseline] ' + JSON.stringify({
      runner: 'GitHub Actions Node, NOT iPhone Safari',
      logicalTicks: 1000,
      agents: 22,
      lastDecisionTick: state.ai.lastDecisionTick,
      autonomousKickCommands: state.appliedCommands.filter(c =>
        c.commandId.startsWith('ai-pass-')).length,
      automaticContactEvents: state.automaticContactEvents.length,
      elapsedMs: Number(elapsed.toFixed(2)),
      checkpointBytes: Buffer.byteLength(JSON.stringify(checkpoint), 'utf8'),
      note: 'Diagnostic football decisions only; no match period, score or FPS.',
    }))
  })
})
