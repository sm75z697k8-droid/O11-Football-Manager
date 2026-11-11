import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

/**
 * Informational baseline for the STATIC two-team foundation on GitHub's Node
 * runner. No timing or heap thresholds are asserted, as runner performance
 * fluctuates and this is NOT an iPhone Safari football-physics benchmark.
 */
describe('Phase 0E informational foundation performance baseline', () => {
  it('reports 108,000 logical steps, checkpoint size and restoration costs', () => {
    const fixture = makeFictionalMatchSetup()
    const initStart = performance.now()
    const engine = createFoundationMatch(fixture)
    const initializationMs = performance.now() - initStart
    const heapBefore = process.memoryUsage().heapUsed

    const advanceStart = performance.now()
    let remaining = 108_000
    while (remaining > 0) {
      const batch = Math.min(remaining, 10_000)
      engine.advance(batch)
      remaining -= batch
    }
    const advanceMs = performance.now() - advanceStart
    const heapAfter = process.memoryUsage().heapUsed

    const checkpointStart = performance.now()
    const json = JSON.stringify(engine.checkpoint())
    const checkpointMs = performance.now() - checkpointStart
    const checkpointBytes = Buffer.byteLength(json, 'utf8')

    const restoreStart = performance.now()
    const restored = restoreFoundationMatch(JSON.parse(json))
    const restoreMs = performance.now() - restoreStart

    expect(engine.getState().clock.tick).toBe(108_000)
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
    expect(engine.getState().players).toHaveLength(22)
    expect(engine.getState().period).toBe('notStarted')
    expect(engine.getState().teams.map((team) => team.score)).toEqual([0, 0])
    expect(engine.getState().players.every((player) =>
      player.velocity.xMps === 0 && player.velocity.yMps === 0)).toBe(true)
    expect(checkpointBytes).toBeGreaterThan(1000)

    console.info('[O11 foundation baseline] ' + JSON.stringify({
      runtime: 'Node GitHub Actions (not iPhone Safari)',
      workload: '2 fictional teams, 22 static player states, no match physics',
      logicalTicks: 108_000,
      initializationMs: Number(initializationMs.toFixed(2)),
      advanceMs: Number(advanceMs.toFixed(2)),
      checkpointMs: Number(checkpointMs.toFixed(2)),
      restoreMs: Number(restoreMs.toFixed(2)),
      checkpointBytes,
      heapDeltaBytes: heapAfter - heapBefore,
      note: 'informational only; cannot predict real gameplay FPS',
    }))
  })
})
