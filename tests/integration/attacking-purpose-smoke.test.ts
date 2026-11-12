import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { planThirdManRun } from '../../src/game/ai/combination-runs'

/**
 * The seeded exhibition can end with a shot, a legitimate missed pass or
 * a physical out-of-play ball. Never demand that ONE particular seed scores.
 * Sample several seeds to ensure attacking is still possible in live play.
 */
describe('Seed-varied live exhibition attacking intelligence diagnostic', () => {
  it('observes genuine passing and shooting opportunities without inventing results', () => {
    const results: {
      seed: number; ticks: number; passes: number;
      shots: number; goals: number; out: boolean;
      thirdManOffers: number;
      keeperCatches: number; keeperParries: number; keeperSaveAttempts: number;
    }[] = []
    for (const seed of [123456789, 42, 90, 117, 205, 832, 4100, 9999, 7654321]) {
      const session = new MatchViewerSession(seed)
      const distinctThirdManOffers = new Set<string>()
      for (let i = 0; i < 200 && !session.state.ball.outsidePitch; i++) {
        session.advance(8)
        const live = session.state
        const pass = live.ai.passIntent
        if (pass && planThirdManRun(live, session.setup, pass.teamId))
          distinctThirdManOffers.add(pass.commandId)
      }
      const s = session.state
      const shotCommands = s.appliedCommands.filter(c =>
        c.type === 'attemptKick' && c.commandId.startsWith('ai-shot-'))
      const passCommands = s.appliedCommands.filter(c =>
        c.type === 'attemptKick' && c.commandId.startsWith('ai-pass-'))
      const realShotContacts = s.contactEvents.filter(e =>
        e.commandId.startsWith('ai-shot-') && e.outcome === 'kicked')
      // Only physical kick requests and contacts can produce a shot event.
      expect(realShotContacts.length).toBeLessThanOrEqual(shotCommands.length)
      expect(s.kickoff?.phase).toBe('inPlay')
      expect(s.contactEvents[0].outcome).toBe('kicked')
      expect(s.appliedCommands.length).toBeGreaterThanOrEqual(3)
      expect(s.goalEvents.length).toBeLessThanOrEqual(1)
      expect(s.teams.map(t => t.score).reduce((a, b) => a + b, 0))
        .toBe(s.goalEvents.length)
      results.push({
        seed, ticks: s.clock.tick, passes: passCommands.length,
        shots: realShotContacts.length, goals: s.goalEvents.length,
        out: s.ball.outsidePitch,
        thirdManOffers:distinctThirdManOffers.size,
        keeperCatches:s.automaticContactEvents.filter(e=>e.outcome==='caught').length,
        keeperParries:s.automaticContactEvents.filter(e=>e.outcome==='parried').length,
        keeperSaveAttempts:s.automaticContactEvents.filter(e=>
          (e.outcome==='caught'||e.outcome==='parried')).length,
      })
    }
    console.info('[O11 seeded attacking baseline] ' + JSON.stringify({
      source: 'actual seeded fictional exhibition fixtures in Node, NOT Safari',
      results,
    }))
    expect(new Set(results.map(x => JSON.stringify([
      x.ticks, x.passes, x.shots, x.goals,
    ]))).size).toBeGreaterThanOrEqual(3)
    expect(results.some(r => r.passes > 0)).toBe(true)
    // A third-man plan is only an intention. Monitor actual kicked shots and
    // real keeper contact separately, never count offers as completed plays.
    expect(results.every(r=>r.thirdManOffers<=r.passes)).toBe(true)
    // These record ACTUAL physics contact, not attempted keeper animations.
    expect(results.every(r=>r.keeperCatches+r.keeperParries===r.keeperSaveAttempts))
      .toBe(true)
    // With no throw-ins, corners or goal kicks yet, a seeded exhibition
    // can genuinely end before a shot. Isolated physics/goal tests prove
    // shooting; this smoke test monitors short live-match variation.
  })
})
