import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MARCUS_RASHFORD, RASHFORD_ATTRIBUTE_SCREENSHOT, RASHFORD_FM_PLAYER_ID,
  RASHFORD_OVR, RASHFORD_POTENTIAL,
} from '../../src/data/real-players/marcus-rashford'
import { FIRST_TEAM, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import { FIRST_TEAM_4231_ASSIGNMENTS } from '../../src/data/first-team-lineup'
import { INITIAL_LOCAL_SQUAD } from '../../src/data/initial-local-squad'
import { categoryRows, readAttribute, toTwenty } from '../../src/game/model/attribute-profile'
import PlayerStatsPanel from '../../src/app/PlayerStatsPanel'
import { makeFictionalMatchSetup } from '../../src/data/fixtures/fictional-match'
import { validateMatchSetup } from '../../src/data/validate'

describe('Marcus Rashford — FM player 28100266 in the Man Utd test team', () => {
  it('adds 77 overall / 87 potential at LW with shirt #9', () => {
    expect(RASHFORD_FM_PLAYER_ID).toBe('28100266')
    expect(RASHFORD_OVR).toBe(77)
    expect(RASHFORD_POTENTIAL).toBe(87)
    expect(MARCUS_RASHFORD.id).toBe('28100266')
    expect(MARCUS_RASHFORD.profile.fullName).toBe('Marcus Rashford')
    expect(MARCUS_RASHFORD.profile.dateOfBirth).toBe('1997-10-31')
    expect(MARCUS_RASHFORD.referenceData).toMatchObject({
      system: 'Football Manager',
      externalPlayerId: 28100266,
      externalClubId: 680,
      overallRating: 77,
      potentialRating: 87,
      attributeSource: 'user-supplied screenshots',
    })
    expect(FIRST_TEAM.players).toHaveLength(11)
    expect(FIRST_TEAM.players[10]).toEqual(MARCUS_RASHFORD)
    expect(FIRST_TEAM.players.filter(p => p.referenceData)).toHaveLength(4)
    expect(FIRST_TEAM.players.filter(p => !p.referenceData)).toHaveLength(7)
    expect(FIRST_TEAM.players.some(p => p.profile.fullName === 'Lucas Duarte')).toBe(false)
    expect(FIRST_TEAM_SHEET.starters[10]).toMatchObject({
      playerId: '28100266', slot: 'LW', shirtNumber: 9,
    })
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(s => s.slot === 'LW')).toMatchObject({
      playerId: '28100266', shirtNumber: 9,
    })
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(s => s.slot === 'CAM')?.shirtNumber).toBe(8)
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(s => s.slot === 'ST')?.shirtNumber).toBe(30)
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(s => s.slot === 'GK')?.shirtNumber).toBe(1)
    expect(new Set(FIRST_TEAM_SHEET.starters.map(s => s.shirtNumber)).size).toBe(11)
    expect(INITIAL_LOCAL_SQUAD.players[10].id).toBe('28100266')
  })

  it('transcribes all 36 screenshot attributes into canonical 0–100 ratings', () => {
    const data = RASHFORD_ATTRIBUTE_SCREENSHOT
    const fields = [
      [data.technical, MARCUS_RASHFORD.abilities.technical],
      [data.mental, MARCUS_RASHFORD.abilities.mental],
      [data.physical, MARCUS_RASHFORD.abilities.physical],
      [data.setPieces, MARCUS_RASHFORD.abilities.technical],
    ] as const
    let count = 0
    for (const [source, current] of fields) {
      for (const [key, value] of Object.entries(source)) {
        const raw = (current as Record<string, number>)[key]
        expect(raw, key).toBe(value * 5)
        expect(toTwenty(raw), key).toBe(value)
        count++
      }
    }
    expect(count).toBe(35)
    expect(toTwenty(readAttribute(MARCUS_RASHFORD, 'hidden.naturalFitness'))).toBe(14)
    expect(MARCUS_RASHFORD.abilities.physical.recovery).toBe(70)
    expect(MARCUS_RASHFORD.referenceData?.provisionalFields)
      .toContain('abilities.physical.recovery')
    expect(MARCUS_RASHFORD.abilities.goalkeeping).toBeNull()
    expect(categoryRows(MARCUS_RASHFORD, 'technical', 'winger')).toHaveLength(10)
    expect(categoryRows(MARCUS_RASHFORD, 'mental', 'winger')).toHaveLength(14)
    expect(categoryRows(MARCUS_RASHFORD, 'physical', 'winger')).toHaveLength(8)
    expect(categoryRows(MARCUS_RASHFORD, 'setPieces', 'winger')).toHaveLength(4)
  })

  it('renders supplied OVR/POT and retains valid legacy engine formation', () => {
    const lw = FIRST_TEAM_4231_ASSIGNMENTS.find(s => s.slot === 'LW')!
    const markup = renderToStaticMarkup(createElement(PlayerStatsPanel, {
      player: MARCUS_RASHFORD, assignment: lw, onClose: () => {},
    })).replace(/<!-- -->/g, '')
    expect(markup).toContain('Marcus Rashford')
    expect(markup).toContain('77 OVR')
    expect(markup).toContain('87 POT')
    expect(markup).toContain('FM ID 28100266')
    expect(markup).toContain('provisional')

    const legacy = makeFictionalMatchSetup()
    const result = validateMatchSetup({
      ...legacy,
      clubs: [FIRST_TEAM.club, legacy.clubs[1]],
      teams: [FIRST_TEAM.sheet, legacy.teams[1]],
      players: [...FIRST_TEAM.players,
        ...legacy.players.filter(p => p.clubId === legacy.clubs[1].id)],
    })
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(true)
    expect(FIRST_TEAM.sheet.formation).toBe('4-3-3')
    expect(INITIAL_LOCAL_SQUAD.lineupPreview.formation).toBe('4-2-3-1')
  })
})
