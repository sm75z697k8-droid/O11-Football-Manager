import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  BENJAMIN_SESKO, SESKO_ATTRIBUTE_SCREENSHOT, SESKO_FM_PLAYER_ID,
  SESKO_OVR, SESKO_POTENTIAL,
} from '../../src/data/real-players/benjamin-sesko'
import { FIRST_TEAM, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import { FIRST_TEAM_4231_ASSIGNMENTS } from '../../src/data/first-team-lineup'
import { categoryRows, readAttribute, toTwenty } from '../../src/game/model/attribute-profile'
import PlayerStatsPanel from '../../src/app/PlayerStatsPanel'
import { validateMatchSetup } from '../../src/data/validate'
import { makeFictionalMatchSetup } from '../../src/data/fixtures/fictional-match'

describe('Benjamin Šeško real-player reference', () => {
  it('has the supplied ID, OVR and potential and occupies #30 at striker', () => {
    expect(SESKO_FM_PLAYER_ID).toBe('62246208')
    expect(SESKO_OVR).toBe(75)
    expect(SESKO_POTENTIAL).toBe(85)
    expect(BENJAMIN_SESKO.profile.fullName).toBe('Benjamin Šeško')
    expect(BENJAMIN_SESKO.referenceData).toMatchObject({
      externalPlayerId: 62246208,
      externalClubId: 680,
      overallRating: 75,
      potentialRating: 85,
      attributeSource: 'user-supplied screenshots',
    })
    expect(FIRST_TEAM.players).toHaveLength(11)
    expect(FIRST_TEAM.players.filter(p => p.referenceData)).toHaveLength(4)
    expect(FIRST_TEAM.players[9]).toEqual(BENJAMIN_SESKO)
    expect(FIRST_TEAM.players.some(p => p.profile.fullName === 'Karim Haddad')).toBe(false)
    expect(FIRST_TEAM_SHEET.starters[9]).toMatchObject({
      playerId: '62246208', slot: 'ST', shirtNumber: 30,
    })
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(a => a.slot === 'ST')).toMatchObject({
      playerId: '62246208', shirtNumber: 30,
    })
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(a => a.slot === 'CAM')).toMatchObject({
      playerId: '43124203', shirtNumber: 8,
    })
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(a => a.slot === 'LDM')).toMatchObject({
      playerId: 'harbor_senior_08', shirtNumber: 10,
    })
    expect(new Set(FIRST_TEAM_SHEET.starters.map(a => a.shirtNumber)).size).toBe(11)
    expect(new Set(FIRST_TEAM_4231_ASSIGNMENTS.map(a => a.shirtNumber)).size).toBe(11)
  })

  it('faithfully maps every screenshot attribute to O11 native values', () => {
    const screenshot = SESKO_ATTRIBUTE_SCREENSHOT
    const fields = [
      [screenshot.technical, BENJAMIN_SESKO.abilities.technical],
      [screenshot.mental, BENJAMIN_SESKO.abilities.mental],
      [screenshot.physical, BENJAMIN_SESKO.abilities.physical],
      [screenshot.setPieces, BENJAMIN_SESKO.abilities.technical],
    ] as const
    let count = 0
    for (const [reference, native] of fields) {
      for (const [key, rating] of Object.entries(reference)) {
        const raw = (native as Record<string, number>)[key]
        expect(raw, key).toBe(rating * 5)
        expect(toTwenty(raw), key).toBe(rating)
        count++
      }
    }
    expect(count).toBe(35)
    expect(toTwenty(readAttribute(BENJAMIN_SESKO,'hidden.naturalFitness')))
      .toBe(screenshot.hidden.naturalFitness)
    expect(categoryRows(BENJAMIN_SESKO,'technical','advancedForward')).toHaveLength(10)
    expect(categoryRows(BENJAMIN_SESKO,'mental','advancedForward')).toHaveLength(14)
    expect(categoryRows(BENJAMIN_SESKO,'physical','advancedForward')).toHaveLength(8)
    expect(categoryRows(BENJAMIN_SESKO,'setPieces','advancedForward')).toHaveLength(4)
    expect(BENJAMIN_SESKO.referenceData?.provisionalFields).toContain('abilities.physical.recovery')
    expect(BENJAMIN_SESKO.abilities.physical.recovery).toBe(70)
  })

  it('renders the actual striker profile and preserves the legacy 4-3-3 engine contract', () => {
    const striker = FIRST_TEAM_4231_ASSIGNMENTS.find(a => a.slot === 'ST')!
    const markup = renderToStaticMarkup(createElement(PlayerStatsPanel, {
      player: BENJAMIN_SESKO, assignment: striker, onClose: () => {},
    })).replace(/<!-- -->/g,'')
    expect(markup).toContain('Benjamin Šeško')
    expect(markup).toContain('75 OVR')
    expect(markup).toContain('85 POT')
    expect(markup).toContain('FM ID 62246208')
    expect(markup).toContain('provisional')
    const legacy = makeFictionalMatchSetup()
    const result = validateMatchSetup({
      ...legacy,
      clubs: [FIRST_TEAM.club, legacy.clubs[1]],
      teams: [FIRST_TEAM.sheet, legacy.teams[1]],
      players: [...FIRST_TEAM.players, ...legacy.players.filter(p => p.clubId === legacy.clubs[1].id)],
    })
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(true)
  })
})
