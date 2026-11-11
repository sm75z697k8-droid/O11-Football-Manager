import { describe, expect, it } from 'vitest'
import {
  CORE_ATTRIBUTE_COUNT, GOALKEEPING_ATTRIBUTES, HIDDEN_CHARACTERISTICS,
  MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, PROFILE_GROUPS, TECHNICAL_ATTRIBUTES,
} from '../../src/game/model/attributes'
import { FORMATION_433_SLOTS } from '../../src/game/model/team'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'

describe('approved player taxonomy', () => {
  it('has 49 core attributes in the agreed groups', () => {
    expect([TECHNICAL_ATTRIBUTES.length, MENTAL_ATTRIBUTES.length, PHYSICAL_ATTRIBUTES.length, GOALKEEPING_ATTRIBUTES.length]).toEqual([14, 14, 8, 13])
    expect(CORE_ATTRIBUTE_COUNT).toBe(49)
    expect(HIDDEN_CHARACTERISTICS).toHaveLength(11)
    expect(PROFILE_GROUPS).toHaveLength(10)
  })

  it('contains no duplicate attribute identifiers', () => {
    const all = [...TECHNICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES, ...PHYSICAL_ATTRIBUTES, ...GOALKEEPING_ATTRIBUTES]
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(HIDDEN_CHARACTERISTICS).size).toBe(11)
  })
})

describe('foundational match geometry', () => {
  it('uses real metres rather than pixels', () => {
    expect(DEFAULT_PITCH.lengthM).toBe(105)
    expect(DEFAULT_PITCH.widthM).toBe(68)
    expect(DEFAULT_PITCH.goalWidthM).toBe(7.32)
  })

  it('defines exactly 11 unique 4-3-3 positions', () => {
    expect(FORMATION_433_SLOTS).toHaveLength(11)
    expect(new Set(FORMATION_433_SLOTS).size).toBe(11)
  })
})
