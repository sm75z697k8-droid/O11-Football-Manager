import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { distinctMatchSeed, MAX_MATCH_SEED } from '../../src/game/core/match-variation'
import {
  chooseSeededOption, decisionDiscretion, MAX_VARIATION_UTILITY_GAP,
} from '../../src/game/ai/decision-variation'

describe('Phase 6.8 separate new and replay seeds', () => {
  it('guarantees NEW differs from REPLAY, even when entropy repeats', () => {
    expect(distinctMatchSeed(123456789, 123456789)).toBe(123456790)
    expect(distinctMatchSeed(MAX_MATCH_SEED, MAX_MATCH_SEED)).toBe(0)
    expect(distinctMatchSeed(1234, 5678)).toBe(5678)
    expect(distinctMatchSeed(0, MAX_MATCH_SEED)).toBe(MAX_MATCH_SEED)
    for (const invalid of [-1, 2 ** 32, NaN, Infinity, 1.5]) {
      expect(() => distinctMatchSeed(23, invalid)).toThrow()
      expect(() => distinctMatchSeed(invalid, 23)).toThrow()
    }
  })
  it('keeps the default exhibition fixture seed for previous diagnostics', () => {
    const a = new MatchViewerSession()
    expect(a.state.seed).toBe(makeFictionalMatchSetup().seed)
    expect(a.setup.seed).toBe(a.state.seed)
  })
  it('offers two genuinely seeded kick-off outlets without changing ratings', () => {
    const base = makeFictionalMatchSetup()
    const recipients = new Set<string>()
    const formations = new Set<string>()
    for (let seed = 1; seed <= 80; seed++) {
      const engine = createFoundationMatch({
        ...base, seed, kickoff: { teamId: base.clubs[0].id },
      })
      const s = engine.getState()
      recipients.add(s.kickoff!.receiverId)
      formations.add(JSON.stringify(s.players.map(p => p.position)))
      expect(s.contactEvents).toHaveLength(0)
      expect(s.ball.position).toEqual({ xM: 52.5, yM: 34 })
      expect(s.teams.map(t => t.score)).toEqual([0, 0])
    }
    expect(recipients.size).toBe(2)
    expect(formations.size).toBe(1)
  })
  it('replays exactly the same physical and tactical state from one seed', () => {
    for (const seed of [1, 7654321, 3456789012]) {
      const a = new MatchViewerSession(seed)
      const b = new MatchViewerSession(seed)
      for (let i = 0; i < 12; i++) a.advance(8)
      for (let i = 0; i < 96; i++) b.advance(1)
      expect(a.checkpoint()).toEqual(b.checkpoint())
      expect(restoreFoundationMatch(a.checkpoint()).checkpoint()).toEqual(a.checkpoint())
    }
  })
  it('changes real football trajectories across distinct new seeds', () => {
    const samples: string[] = []
    for (const seed of [42, 90, 117, 205, 832, 4100, 9999, 123456789]) {
      const session = new MatchViewerSession(seed)
      for (let i = 0; i < 12; i++) session.advance(8)
      const s = session.state
      samples.push(JSON.stringify({
        receiverId: s.kickoff?.receiverId,
        ball: s.ball.position,
        contacts: s.contactEvents.map(c => [c.playerId, c.outcome]),
        kicks: s.appliedCommands.filter(c => c.type === 'attemptKick')
          .map(c => [c.playerId, c.target, c.power]),
      }))
      expect(s.seed).toBe(seed)
      expect(s.kickoff?.phase).toBe('inPlay')
    }
    expect(new Set(samples).size).toBeGreaterThanOrEqual(3)
  })
})

describe('Phase 6.8 bounded seeded football judgment', () => {
  const options = [
    { kind: 'pass', utility: 20 },
    { kind: 'carry', utility: 19.7 },
    { kind: 'shoot', utility: 19.3 },
  ] as const
  it('chooses identically for the same seed/player/tick without mutation', () => {
    const before = JSON.stringify(options)
    expect(chooseSeededOption(options, 512, 'midfielder_08', 315, 64, 56, 78))
      .toEqual(chooseSeededOption(options, 512, 'midfielder_08', 315, 64, 56, 78))
    expect(JSON.stringify(options)).toBe(before)
  })
  it('lets multiple seeds change near-equal action decisions', () => {
    const outcomes = new Set<string>()
    for (let seed = 1; seed <= 64; seed++) {
      outcomes.add(chooseSeededOption(options, seed, 'midfielder_08',
        315, 64, 56, 78)!.kind)
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(2)
  })
  it('does not select an obviously inferior pass or shot simply for variety', () => {
    const decisions = [
      { kind: 'carry', utility: 58 },
      { kind: 'pass', utility: 45 },
      { kind: 'shoot', utility: 37 },
    ] as const
    for (let seed = 0; seed < 64; seed++) {
      expect(chooseSeededOption(decisions, seed, 'striker', 110,
        10, 10, 10)?.kind).toBe('carry')
    }
    expect(MAX_VARIATION_UTILITY_GAP).toBeLessThan(8)
    expect(chooseSeededOption([], 1, 'striker', 1, 50, 50, 50)).toBeNull()
  })
  it('lets more mentally capable players make more consistent decisions', () => {
    expect(decisionDiscretion(95, 95, 95))
      .toBeLessThan(decisionDiscretion(30, 30, 30))
    expect(decisionDiscretion(99, 90, 100)).toBeGreaterThan(0)
  })
})
