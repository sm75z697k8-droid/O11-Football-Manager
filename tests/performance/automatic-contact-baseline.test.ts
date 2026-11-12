import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

/** Informational GitHub Node workload; not iPhone Safari FPS or a match benchmark. */
describe('Phase 4 engagement collision workload', () => {
  it('processes 22 engaged players and a moving ball without tactical AI', () => {
    const game = createFoundationMatch(makeFictionalMatchSetup())
    const players = game.getState().players
    for (const p of players) {
      expect(game.submitCommand({
        commandId: 'engagement-' + p.playerId,
        type: 'setBallEngagement', teamId: p.clubId,
        playerId: p.playerId, enabled: true,
      }).accepted).toBe(true)
    }
    game.submitCommand({
      commandId: 'ball-test', type: 'diagnosticBallLaunch', teamId: 'club_harbor',
      velocity: { xMps: 18, yMps: 0, zMps: 0 },
    })
    const started = performance.now()
    game.advance(1000)
    const elapsed = performance.now() - started
    const result = game.getState()
    expect(result.players.filter(p => p.engagesBall)).toHaveLength(22)
    expect(result.clock.tick).toBe(1000)
    expect(result.automaticContactEvents.length).toBeGreaterThanOrEqual(1)
    expect(result.teams.map(t => t.score)).toEqual([0, 0])
    const checkpoint = game.checkpoint()
    expect(restoreFoundationMatch(checkpoint).checkpoint()).toEqual(checkpoint)
    console.info('[O11 Phase 4 automatic contact baseline] ' + JSON.stringify({
      environment: 'GitHub Actions Node, not iPhone Safari',
      workload: '22 engaged players, one diagnostic ball, no tactical AI',
      logicalTicks: 1000,
      automaticContacts: result.automaticContactEvents.length,
      elapsedMs: Number(elapsed.toFixed(2)),
      checkpointBytes: Buffer.byteLength(JSON.stringify(checkpoint), 'utf8'),
    }))
  })
})
