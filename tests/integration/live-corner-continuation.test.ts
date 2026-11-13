import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { restoreFoundationMatch } from '../../src/game/match/engine'

describe('S1.3 actual seeded football match corner continuation', () => {
  it('plays a physically awarded corner and replays deterministically', () => {
    const observations: Array<{
      seed: number; tick: number; awards: number;
      releases: number; terminal: string | null;
    }> = []
    let confirmed = false
    const seeds = [
      832, 90, 42, 117, 205, 101, 57, 23017,
      9999, 1, 2, 3, 4, 5, 6, 7654321,
      123456789, 4100, 4567, 5678, 130, 777,
    ]
    for (const seed of seeds) {
      const match = new MatchViewerSession(seed)
      for (let tick = 0; tick < 6500; tick += 8) {
        match.advance(8)
        const state = match.state
        if (state.contactEvents.some(e => e.outcome === 'cornerKicked') ||
            state.goalEvents.length) break
        if (state.clock.tick === 0 ||
            (state.restart && !['throwIn','goalKick','corner']
              .includes(state.restart.kind))) break
      }
      const state = match.state
      const awards = state.outOfPlayEvents.filter(e => e.kind === 'corner').length
      const releases = state.contactEvents.filter(e =>
        e.kind === 'cornerKick' && e.outcome === 'cornerKicked')
      observations.push({
        seed, tick: state.clock.tick, awards, releases: releases.length,
        terminal: state.restart?.kind ?? null,
      })
      if (!releases.length) continue
      confirmed = true
      expect(awards).toBeGreaterThanOrEqual(releases.length)
      expect(state.restart).toBeNull()
      expect(state.ball.controllerId).toBeNull()
      expect(state.ball.outsidePitch).toBe(false)
      const taker = state.players.find(p =>
        p.playerId === releases[0].playerId)
      expect(taker?.formationSlot).not.toBe('GK')
      const restored = restoreFoundationMatch(match.checkpoint())
      expect(restored.getState()).toEqual(state)
      match.advance(8)
      restored.advance(8)
      expect(restored.checkpoint()).toEqual(match.checkpoint())
      break
    }
    console.info('[O11 S1.3 LIVE CORNER SAMPLE]', JSON.stringify(observations))
    expect(confirmed).toBe(true)
  })
})
