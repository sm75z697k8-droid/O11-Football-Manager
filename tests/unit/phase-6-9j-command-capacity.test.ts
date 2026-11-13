import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MAX_COMMANDS_PER_MATCH } from '../../src/game/match/commands'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { copyableMatchDiagnostics } from '../../src/game/viewer/match-diagnostics'

describe('Phase 6.9J — long-match AI command continuity', () => {
  it('accepts and replays real commands past the previous 256-action limit', () => {
    const setup = makeFictionalMatchSetup()
    const engine = createFoundationMatch(setup)
    const count = 270
    expect(MAX_COMMANDS_PER_MATCH).toBeGreaterThanOrEqual(4096)
    // Real valid team commands and unique IDs; no fabricated history
    // inserted into the state or bypassed command validation.
    for (let i = 0; i < count; i++) {
      const receipt = engine.submitCommand({
        commandId: 'long-match-press-' + i,
        teamId: setup.clubs[i % 2].id,
        type: 'setPressingIntensity',
        intensity: i % 3 === 0 ? 'high' : 'standard',
      })
      expect(receipt.accepted, 'command ' + i).toBe(true)
    }
    const result = engine.advance(1)
    expect(result.nextCommandSequence).toBe(count + 1)
    expect(result.appliedCommands).toHaveLength(count)
    expect(result.pendingCommands).toHaveLength(0)
    const saved = engine.checkpoint()
    expect(restoreFoundationMatch(saved).checkpoint()).toEqual(saved)
    // Continue after the old cap, including an additional new command.
    const extra = engine.submitCommand({
      commandId: 'long-match-extra-command',
      teamId: setup.clubs[0].id,
      type: 'setPressingIntensity',
      intensity: 'low',
    })
    expect(extra.accepted).toBe(true)
    engine.advance(1)
    expect(engine.getState().appliedCommands).toHaveLength(count + 1)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint())
      .toEqual(engine.checkpoint())
  })
  it('exports a copyable exact-version report with no altered simulation state', () => {
    const session = new MatchViewerSession(0x8BE673A4)
    session.advance(8)
    const before = JSON.stringify(session.state)
    const report = JSON.parse(copyableMatchDiagnostics(session.state))
    expect(report.seed).toBe('8BE673A4')
    expect(report.time).toBe('00:00')
    expect(report.tick).toBe(8)
    expect(report.engineVersion).toBe(session.state.engineVersion)
    expect(report.commandsUsed).toBe(session.state.nextCommandSequence - 1)
    expect(report.aiTeams).toEqual([true,true])
    expect(report.ball.controller).toEqual(session.state.ball.controllerId)
    expect(JSON.stringify(session.state)).toBe(before)
  })
  it('keeps both AI teams autonomous when using a reported seed', () => {
    const session = new MatchViewerSession(0x8BE673A4)
    session.advance(8)
    expect(session.state.ai.enabledTeams).toEqual([true,true])
    expect(session.state.seed).toBe(0x8BE673A4)
    expect(session.state.contactEvents[0].outcome).toBe('kicked')
  })
})
