import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

/** Informational Node-only physics workload; never claim iPhone Safari FPS. */
describe('Phase 3 contact and checkpoint workload', () => {
  it('measures a reachable first touch, a kick, and continued ball flight', () => {
    const fixture = makeFictionalMatchSetup()
    const engine = createFoundationMatch(fixture)
    const striker = engine.getState().players[9]
    const start = performance.now()
    engine.submitCommand({
      commandId: 'launch', teamId: 'club_harbor', type: 'diagnosticBallLaunch',
      velocity: { xMps: 10, yMps: 0, zMps: 0 },
    })
    engine.advance(52)
    engine.submitCommand({
      commandId: 'first-touch', teamId: striker.clubId,
      type: 'attemptFirstTouch', playerId: striker.playerId,
    })
    engine.advance()
    const firstTouch = engine.getState().contactEvents.at(-1)
    expect(firstTouch?.outcome).toBe('controlled')
    engine.submitCommand({
      commandId: 'kick', teamId: striker.clubId, type: 'attemptKick',
      playerId: striker.playerId, target: { xM: 100, yM: 34 },
      power: 0.8, lift: 0.4,
    })
    engine.advance(600)
    const elapsed = performance.now() - start
    const checkpoint = engine.checkpoint()
    const bytes = Buffer.byteLength(JSON.stringify(checkpoint), 'utf8')
    const restored = restoreFoundationMatch(JSON.parse(JSON.stringify(checkpoint)))
    expect(restored.checkpoint()).toEqual(checkpoint)
    expect(engine.getState().contactEvents.map((e) => e.outcome)).toEqual([
      'controlled', 'kicked',
    ])
    expect(engine.getState().teams.map((t) => t.score)).toEqual([0, 0])
    console.info('[O11 Phase 3 contact baseline] ' + JSON.stringify({
      runtime: 'GitHub Actions Linux Node, NOT iPhone Safari',
      workload: '2 contact attempts + free ball/player ticks, no match AI',
      logicalTicks: 653,
      elapsedMs: Number(elapsed.toFixed(2)),
      checkpointBytes: bytes,
      note: 'Informational only; not a full match or FPS benchmark.',
    }))
  })
})
