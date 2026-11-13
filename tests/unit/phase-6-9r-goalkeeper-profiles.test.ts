import { describe, expect, it } from 'vitest'
import {
  GOALKEEPER_COMPARISON_PROFILES, makeExhibitionMatchSetup,
} from '../../src/data/fixtures/keeper-comparison'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { assertValidMatchSetup } from '../../src/data/validate'
import { goalkeeperSaveWindow } from '../../src/game/physics/goalkeeper-saves'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { restoreFoundationMatch } from '../../src/game/match/engine'

function keepers() {
  const comparison = makeExhibitionMatchSetup('keeper-comparison')
  const harbor = comparison.players.find(p =>
    p.clubId === comparison.clubs[0].id && p.abilities.goalkeeping)!
  const vale = comparison.players.find(p =>
    p.clubId === comparison.clubs[1].id && p.abilities.goalkeeping)!
  return { comparison, harbor, vale }
}

describe('Phase 6.9R goalkeeper archetype test fixture', () => {
  it('preserves the balanced canonical fixture and never mutates it', () => {
    const original = makeFictionalMatchSetup()
    const exact = JSON.stringify(original)
    const balanced = makeExhibitionMatchSetup('balanced')
    const contrasting = makeExhibitionMatchSetup('keeper-comparison')
    expect(balanced).toEqual(original)
    expect(JSON.stringify(original)).toBe(exact)
    expect(contrasting.matchId).not.toBe(original.matchId)
    expect(contrasting.players.filter(p => !p.abilities.goalkeeping))
      .toEqual(original.players.filter(p => !p.abilities.goalkeeping))
    expect(contrasting.clubs).toEqual(original.clubs)
    expect(contrasting.teams).toEqual(original.teams)
    expect(contrasting.pitch).toEqual(original.pitch)
    expect(assertValidMatchSetup(contrasting)).toEqual(contrasting)
  })

  it('actually changes only goalkeeper ratings, with advertised profiles', () => {
    const original = makeFictionalMatchSetup()
    const { comparison, harbor, vale } = keepers()
    for (const current of [harbor, vale]) {
      const base = original.players.find(p => p.id === current.id)!
      expect(current.abilities.technical).toEqual(base.abilities.technical)
      expect(current.abilities.mental).toEqual(base.abilities.mental)
      expect(current.abilities.physical).toEqual(base.abilities.physical)
      expect(current.hidden).toEqual(base.hidden)
      expect(current.profile).toEqual(base.profile)
    }
    const a = harbor.abilities.goalkeeping!
    const b = vale.abilities.goalkeeping!
    expect(a).toMatchObject(GOALKEEPER_COMPARISON_PROFILES.club_harbor.attributes)
    expect(b).toMatchObject(GOALKEEPER_COMPARISON_PROFILES.club_vale.attributes)
    expect(a.reflexes).toBeGreaterThan(b.reflexes)
    expect(a.diving).toBeGreaterThan(b.diving)
    expect(b.handling).toBeGreaterThan(a.handling)
    expect(b.parrying).toBeGreaterThan(a.parrying)
    expect(b.positioning).toBeGreaterThan(a.positioning)
    expect(comparison.players).toHaveLength(22)
  })

  it('changes real physical goalkeeper reaction and reach rather than visual badges', () => {
    const { harbor, vale } = keepers()
    const earlyHarbor = goalkeeperSaveWindow(harbor, 54, 50)
    const earlyVale = goalkeeperSaveWindow(vale, 54, 50)
    expect(earlyHarbor.reactionDelaySeconds)
      .toBeLessThan(earlyVale.reactionDelaySeconds)
    const lateHarbor = goalkeeperSaveWindow(harbor, 65, 50)
    const lateVale = goalkeeperSaveWindow(vale, 65, 50)
    expect(lateHarbor.reachM).toBeGreaterThan(lateVale.reachM)
    expect(lateHarbor.maximumHeightM)
      .toBeLessThan(lateVale.maximumHeightM)
  })

  it('keeps replay deterministic within each mode and differentiates fixture identity', () => {
    const seed = 205
    const left = new MatchViewerSession(seed, 'keeper-comparison')
    const right = new MatchViewerSession(seed, 'keeper-comparison')
    const control = new MatchViewerSession(seed, 'balanced')
    expect(left.preset).toBe('keeper-comparison')
    expect(control.preset).toBe('balanced')
    expect(left.state.seed).toBe(control.state.seed)
    expect(left.setup.matchId).not.toBe(control.setup.matchId)
    expect(left.setup.players).not.toEqual(control.setup.players)
    left.advance(8)
    right.advance(8)
    control.advance(8)
    expect(left.checkpoint()).toEqual(right.checkpoint())
    expect(restoreFoundationMatch(left.checkpoint()).checkpoint())
      .toEqual(left.checkpoint())
    expect(left.state.ball.position).toEqual(control.state.ball.position)
  })

  it('rejects unknown presets rather than disguising invalid data', () => {
    expect(() => makeExhibitionMatchSetup('unlisted' as 'balanced'))
      .toThrow('Unknown match exhibition preset')
  })
})
