import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTE_CATEGORIES, ATTRIBUTE_ROLE_FOCUS,
  attributeProfile, categoryRows, readAttribute, toTwenty,
} from '../../src/game/model/attribute-profile'
import { FIRST_TEAM_PLAYERS, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import { makeFictionalMatchSetup } from '../../src/data/fixtures/fictional-match'

describe('FM-style attribute profile driven by the existing engine', () => {
  const striker = FIRST_TEAM_PLAYERS.find(p => p.id === FIRST_TEAM_SHEET.starters[9].playerId)!
  const keeper = FIRST_TEAM_PLAYERS[0]

  it('converts 0–100 display values without editing their source', () => {
    expect(toTwenty(0)).toBe(1)
    expect(toTwenty(50)).toBe(10)
    expect(toTwenty(51)).toBe(11)
    expect(toTwenty(80)).toBe(16)
    expect(toTwenty(100)).toBe(20)
    expect(() => toTwenty(NaN)).toThrow()
    expect(() => toTwenty(-1)).toThrow()
    expect(() => toTwenty(101)).toThrow()
    const passing = categoryRows(striker, 'technical','advancedForward')
      .find(row => row.label === 'Passing')!
    expect(passing.raw).toBe(striker.abilities.technical.passing)
    expect(passing.score).toBe(toTwenty(passing.raw))
    const natural = categoryRows(striker,'physical','advancedForward')
      .find(row => row.label === 'Natural Fitness')!
    expect(natural.raw).toBe(striker.hidden.naturalFitness)
    expect(readAttribute(striker,natural.path)).toBe(natural.raw)
  })

  it('maps all supplied screenshot categories and keeps goalkeeping distinct', () => {
    expect(ATTRIBUTE_CATEGORIES.technical).toHaveLength(10)
    expect(ATTRIBUTE_CATEGORIES.mental).toHaveLength(14)
    expect(ATTRIBUTE_CATEGORIES.physical).toHaveLength(8)
    expect(ATTRIBUTE_CATEGORIES.setPieces.map(x => x.label)).toEqual([
      'Corners','Free Kick Taking','Long Throws','Penalty Taking',
    ])
    expect(ATTRIBUTE_CATEGORIES.goalkeeping).toHaveLength(13)
    expect(ATTRIBUTE_CATEGORIES.physical.map(x => x.label)).toEqual([
      'Acceleration','Agility','Balance','Jumping Reach','Natural Fitness','Pace','Stamina','Strength',
    ])
    expect(Object.values(ATTRIBUTE_CATEGORIES).flat().every(x =>
      Number.isInteger(readAttribute(keeper,x.path)))).toBe(true)
    expect(() => readAttribute(striker,'goalkeeping.reflexes')).toThrow()
  })

  it('derives role emphasis without modifying match outcomes or ratings', () => {
    const before = striker.abilities.technical.finishing
    expect(categoryRows(striker,'technical','advancedForward')
      .find(x => x.label === 'Finishing')?.priority).toBe('key')
    expect(categoryRows(striker,'technical','advancedForward')
      .find(x => x.label === 'First Touch')?.priority).toBe('preferred')
    expect(ATTRIBUTE_ROLE_FOCUS.winger.key).toContain('technical.dribbling')
    expect(striker.abilities.technical.finishing).toBe(before)
  })

  it('recomputes the 8-axis radar from the canonical match ratings', () => {
    const base = attributeProfile(striker)
    expect(base.map(x => x.label)).toEqual([
      'Defending','Physical','Speed','Vision','Attacking','Technical','Aerial','Mental',
    ])
    expect(base.every(x => x.score >= 1 && x.score <= 20)).toBe(true)
    const improved = {
      ...striker, abilities: {
        ...striker.abilities,
        technical: { ...striker.abilities.technical, finishing: 100 },
      },
    }
    const updated = attributeProfile(improved)
    expect(updated[4].score).toBeGreaterThan(base[4].score)
    expect(updated[1].score).toBe(base[1].score)
    expect(attributeProfile(keeper)[0].label).toBe('Reflexes')
  })

  it('reads existing 22-player match data without a migration', () => {
    const legacy = makeFictionalMatchSetup().players[2]
    expect(categoryRows(legacy,'mental','centreBack')).toHaveLength(14)
    expect(attributeProfile(legacy)).toHaveLength(8)
  })
})
