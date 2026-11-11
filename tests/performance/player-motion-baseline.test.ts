import { describe, expect, it } from 'vitest'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

/**
 * Informational Node-only movement workload — NOT an iPhone or playable-match
 * frame-rate benchmark. No performance threshold: GitHub runners vary.
 */
describe('Phase 1 individual player locomotion workload', () => {
  it('profiles 22 commanded agents for 300 fixed physical ticks', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const starting = engine.getState()
    starting.players.forEach((p, i) => {
      const home = i < 11
      const xM = Math.max(0, Math.min(105, p.position.xM + (home ? 32 : -32)))
      const yM = Math.max(0, Math.min(68, p.position.yM + (i % 2 ? 9 : -9)))
      const receipt = engine.submitCommand({
        commandId: 'motion-' + i, teamId: p.clubId,
        type: 'setMovementTarget', playerId: p.playerId, target: { xM, yM },
      })
      expect(receipt.accepted).toBe(true)
    })
    const start = performance.now()
    engine.advance(300)
    const elapsed = performance.now() - start
    const state = engine.getState()
    const moved = state.players.filter((p, i) =>
      Math.hypot(p.position.xM - starting.players[i].position.xM,
        p.position.yM - starting.players[i].position.yM) > 0.1)
    const bytes = Buffer.byteLength(JSON.stringify(engine.checkpoint()), 'utf8')

    expect(state.clock.tick).toBe(300)
    expect(moved).toHaveLength(22)
    expect(state.players.every((p) => Number.isFinite(p.position.xM) &&
      Number.isFinite(p.position.yM) &&
      p.position.xM >= 0 && p.position.xM <= 105 &&
      p.position.yM >= 0 && p.position.yM <= 68)).toBe(true)
    expect(state.ball).toEqual(starting.ball)
    expect(state.teams.map((t) => t.score)).toEqual([0, 0])

    console.info('[O11 Phase 1 locomotion baseline] ' + JSON.stringify({
      runtime: 'Node GitHub Actions, NOT iPhone Safari',
      workload: '22 independent players, explicit targets, no ball/AI/collisions',
      simulationTicks: 300,
      durationMs: Number(elapsed.toFixed(2)),
      avgMsPerTick: Number((elapsed / 300).toFixed(4)),
      movedPlayers: moved.length,
      checkpointBytes: bytes,
      note: 'Informational benchmark only. No real match FPS inference.',
    }))
  })
})
