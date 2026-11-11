import { describe, expect, it } from 'vitest'
import { assertValidMatchSetup, validateMatchSetup } from '../../src/data/validate'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

function cloned(): Record<string, any> {
  return structuredClone(makeFictionalMatchSetup()) as Record<string, any>
}

function mustReject(input: unknown, expectedPath: string): void {
  const result = validateMatchSetup(input)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.issues.some((issue) => issue.path.includes(expectedPath))).toBe(true)
}

describe('fictional 11v11 match setup validation', () => {
  it('accepts an explicitly fictional two-club 4-3-3 fixture', () => {
    const setup = makeFictionalMatchSetup()
    const result = validateMatchSetup(setup)
    expect(result.ok).toBe(true)
    expect(setup.players).toHaveLength(22)
    expect(setup.teams[0].starters).toHaveLength(11)
    expect(setup.teams[1].starters).toHaveLength(11)
    expect(assertValidMatchSetup(setup)).toBe(setup)
  })

  it('accepts a different consistent metric pitch', () => {
    const match = cloned()
    match.pitch.lengthM = 108
    match.pitch.widthM = 70
    expect(validateMatchSetup(match).ok).toBe(true)
  })

  it('rejects duplicate player IDs', () => {
    const match = cloned()
    match.players[1].id = match.players[0].id
    mustReject(match, 'players[1].id')
  })

  it('rejects an incomplete, out-of-range, or unknown attribute', () => {
    const match = cloned()
    delete match.players[0].abilities.technical.passing
    match.players[1].abilities.physical.acceleration = 101
    match.players[2].abilities.mental.unknownSkill = 70
    mustReject(match, 'abilities.technical.passing')
    mustReject(match, 'abilities.physical.acceleration')
    mustReject(match, 'abilities.mental.unknownSkill')
  })

  it('rejects a starting goalkeeper without goalkeeper abilities', () => {
    const match = cloned()
    match.players[0].abilities.goalkeeping = null
    mustReject(match, 'teams[0].starters[0].playerId')
  })

  it('rejects duplicate lineup slots and cross-club assignments', () => {
    const match = cloned()
    match.teams[0].starters[1].slot = 'GK'
    match.teams[1].starters[1].playerId = match.players[1].id
    mustReject(match, 'teams[0].starters[1].slot')
    mustReject(match, 'teams[1].starters[1].playerId')
  })

  it('rejects incorrect roster sizes, bad dates, and invalid seeds', () => {
    const match = cloned()
    match.players.pop()
    match.players[0].profile.dateOfBirth = '2001-02-30'
    match.seed = -1
    mustReject(match, 'players')
    mustReject(match, 'dateOfBirth')
    mustReject(match, 'seed')
  })

  it('rejects inconsistent pitch geometry', () => {
    const match = cloned()
    match.pitch.penaltyAreaWidthM = 100
    mustReject(match, 'pitch')
  })

  it('rejects unsupported setup versions', () => {
    const match = cloned()
    match.setupVersion = 999
    mustReject(match, 'setupVersion')
  })

  it('does not mutate input while validating it', () => {
    const match = cloned()
    const before = JSON.stringify(match)
    expect(validateMatchSetup(match).ok).toBe(true)
    expect(JSON.stringify(match)).toBe(before)
  })
})
