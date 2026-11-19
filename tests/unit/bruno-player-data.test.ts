import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FIRST_TEAM, FIRST_TEAM_PLAYERS } from '../../src/data/first-team'
import { FIRST_TEAM_4231_ASSIGNMENTS } from '../../src/data/first-team-lineup'
import {
  BRUNO_ATTRIBUTE_SCREENSHOT, BRUNO_FERNANDES, BRUNO_FM_PLAYER_ID,
  BRUNO_OVR, BRUNO_POTENTIAL, MAN_UTD_FM_CLUB_ID,
} from '../../src/data/real-players/bruno-fernandes'
import { categoryRows, readAttribute, toTwenty } from '../../src/game/model/attribute-profile'
import PlayerStatsPanel from '../../src/app/PlayerStatsPanel'

describe('Bruno Fernandes user-supplied FM profile', () => {
  it('retains Bruno at CAM with his original attribute ratings and external identity', () => {
    expect(FIRST_TEAM.players).toHaveLength(11)
    expect(FIRST_TEAM.players[7]).toEqual(BRUNO_FERNANDES)
    expect(FIRST_TEAM_PLAYERS.filter(p => p.referenceData)).toHaveLength(3)
    expect(FIRST_TEAM.players.filter(p => !p.referenceData)).toHaveLength(8)
    expect(FIRST_TEAM.players.every(p => p.clubId === FIRST_TEAM.club.id)).toBe(true)
    expect(FIRST_TEAM.club.fmUid).toBe(MAN_UTD_FM_CLUB_ID)
    expect(BRUNO_FERNANDES.id).toBe(BRUNO_FM_PLAYER_ID)
    expect(BRUNO_FERNANDES.referenceData).toMatchObject({
      system: 'Football Manager',
      externalPlayerId: 43124203,
      externalClubId: 680,
      overallRating: BRUNO_OVR,
      potentialRating: BRUNO_POTENTIAL,
      attributeSource: 'user-supplied screenshots',
    })
    expect(BRUNO_OVR).toBe(89)
    expect(BRUNO_POTENTIAL).toBe(89)
    const cam = FIRST_TEAM_4231_ASSIGNMENTS.find(p => p.slot === 'CAM')
    expect(cam?.playerId).toBe('43124203')
    expect(cam?.shirtNumber).toBe(8)
  })

  it('reproduces all 36 supplied 1–20 ratings via the canonical 0–100 values', () => {
    const screenshot = BRUNO_ATTRIBUTE_SCREENSHOT
    const groups = [
      ['technical', screenshot.technical, BRUNO_FERNANDES.abilities.technical],
      ['mental', screenshot.mental, BRUNO_FERNANDES.abilities.mental],
      ['physical', screenshot.physical, BRUNO_FERNANDES.abilities.physical],
      ['setPieces', screenshot.setPieces, BRUNO_FERNANDES.abilities.technical],
    ] as const
    let count = 0
    for (const [, expected, actual] of groups) {
      for (const [key, value] of Object.entries(expected)) {
        const engine = (actual as unknown as Record<string, number>)[key]
        expect(engine).toBe(value * 5)
        expect(toTwenty(engine)).toBe(value)
        count++
      }
    }
    expect(count).toBe(35)
    expect(toTwenty(readAttribute(BRUNO_FERNANDES,'hidden.naturalFitness')))
      .toBe(screenshot.hidden.naturalFitness)
    expect(BRUNO_FERNANDES.abilities.physical.recovery).toBe(70)
    expect(BRUNO_FERNANDES.referenceData?.provisionalFields)
      .toContain('abilities.physical.recovery')
    expect(BRUNO_FERNANDES.hidden.naturalFitness).toBe(100)
    expect(BRUNO_FERNANDES.abilities.goalkeeping).toBeNull()
    expect(categoryRows(BRUNO_FERNANDES,'technical','attackingMidfielder')).toHaveLength(10)
    expect(categoryRows(BRUNO_FERNANDES,'mental','attackingMidfielder')).toHaveLength(14)
    expect(categoryRows(BRUNO_FERNANDES,'physical','attackingMidfielder')).toHaveLength(8)
    expect(categoryRows(BRUNO_FERNANDES,'setPieces','attackingMidfielder')).toHaveLength(4)
  })

  it('shows source ID and requested overall/potential distinctly in player details', () => {
    const cam = FIRST_TEAM_4231_ASSIGNMENTS.find(p => p.slot === 'CAM')!
    const markup = renderToStaticMarkup(createElement(PlayerStatsPanel, {
      player: BRUNO_FERNANDES,
      assignment: cam,
      onClose: () => {},
    })).replace(/<!-- -->/g, '')
    expect(markup).toContain('Bruno Fernandes')
    expect(markup).toContain('89 OVR')
    expect(markup).toContain('89 POT')
    expect(markup).toContain('FM ID 43124203')
    expect(markup).toContain('FM club ID 680')
    expect(markup).toContain('provisional')
  })
})
