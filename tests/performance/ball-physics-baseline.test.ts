import { describe, expect, it } from 'vitest'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

/** Node-only diagnostic workload; NOT an iPhone FPS or match benchmark. */
describe('Phase 2 ball physics workload', () => {
  it('profiles flight and rolling physics over four launch events', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const initial = engine.getState()
    const start = performance.now()
    for (let i = 0; i < 4; i += 1) {
      const receipt = engine.submitCommand({
        commandId: 'test-launch-' + i,
        teamId: i % 2 === 0 ? 'club_harbor' : 'club_vale',
        type: 'diagnosticBallLaunch',
        velocity: {
          xMps: i % 2 === 0 ? 14 : -17,
          yMps: i % 2 === 0 ? 3 : -5,
          zMps: i % 2 === 0 ? 8 : 0,
        },
      })
      expect(receipt.accepted).toBe(true)
      engine.advance(500)
    }
    const elapsed = performance.now() - start
    const state = engine.getState()
    const bytes = Buffer.byteLength(JSON.stringify(engine.checkpoint()), 'utf8')
    expect(state.clock.tick).toBe(2000)
    expect(state.ball.position).not.toEqual(initial.ball.position)
    expect(state.ball.heightM).toBeGreaterThanOrEqual(0.11)
    expect(state.players).toEqual(initial.players)
    expect(state.teams.map((team) => team.score)).toEqual([0, 0])
    expect(state.ball.controllerId).toBeNull()
    console.info('[O11 Phase 2 ball baseline] ' + JSON.stringify({
      runtime: 'GitHub Actions Node; NOT iPhone Safari',
      workload: '2 fictional teams, free ball flight and ground roll; no AI',
      logicalTicks: 2000,
      elapsedMs: Number(elapsed.toFixed(2)),
      avgMsPerTick: Number((elapsed / 2000).toFixed(4)),
      checkpointBytes: bytes,
      note: 'Informational only. No game FPS prediction.',
    }))
  })
})
