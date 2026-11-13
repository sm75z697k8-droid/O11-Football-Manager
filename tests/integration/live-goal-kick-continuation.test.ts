import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { restoreFoundationMatch } from '../../src/game/match/engine'

/**
 * Detect real goal-kick interruptions in actual 22-player seeded exhibitions.
 * This is a physical simulation integration test; no fake restart events or
 * pre-assigned possessions are inserted by the test.
 */
describe('S1.2 live seeded match goal kicks', () => {
  it('executes a real goalkeeper kick and continues the deterministic match', () => {
    const observations = []
    let completed = false
    for (const seed of [832, 42, 90, 117, 205, 4100, 9999,
      7654321, 123456789, 23017, 101, 57]) {
      const session = new MatchViewerSession(seed)
      for (let i = 0; i < 4200; i += 8) {
        session.advance(8)
        const s = session.state
        if (s.contactEvents.some(e => e.outcome === 'goalKicked') ||
            s.goalEvents.length ||
            (s.restart?.kind === 'corner')) break
      }
      const state = session.state
      const awards = state.outOfPlayEvents.filter(e =>
        e.kind === 'goalKick').length
      const releases = state.contactEvents.filter(e =>
        e.kind === 'goalKick' && e.outcome === 'goalKicked')
      observations.push({
        seed, tick: state.clock.tick, goalKicksAwarded: awards,
        physicalReleases: releases.length, pendingRestart: state.restart?.kind ?? null,
      })
      if (!releases.length) continue
      expect(awards).toBeGreaterThanOrEqual(releases.length)
      expect(state.restart).toBeNull()
      expect(state.ball.outsidePitch).toBe(false)
      const actual = state.players.find(p =>
        p.playerId === releases[0].playerId)
      expect(actual?.formationSlot).toBe('GK')
      const reconstructed = restoreFoundationMatch(session.checkpoint())
      expect(reconstructed.getState()).toEqual(state)
      session.advance(8)
      reconstructed.advance(8)
      expect(reconstructed.checkpoint()).toEqual(session.checkpoint())
      completed = true
      break
    }
    console.info('[O11 S1.2 REAL GOAL KICKS]', JSON.stringify(observations))
    expect(completed).toBe(true)
  })
})
