import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  LAMMENS_FM_PLAYER_ID, LAMMENS_OVR, LAMMENS_POTENTIAL,
  LAMMENS_SCREENSHOT, SENNE_LAMMENS,
} from '../../src/data/real-players/senne-lammens'
import { FIRST_TEAM, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import { FIRST_TEAM_4231_ASSIGNMENTS } from '../../src/data/first-team-lineup'
import { INITIAL_LOCAL_SQUAD } from '../../src/data/initial-local-squad'
import { categoryRows, readAttribute, toTwenty } from '../../src/game/model/attribute-profile'
import PlayerStatsPanel from '../../src/app/PlayerStatsPanel'
import { makeFictionalMatchSetup } from '../../src/data/fixtures/fictional-match'
import { validateMatchSetup } from '../../src/data/validate'

describe('Senne Lammens player ID 18107436, number 1', () => {
  it('replaces only the fictional GK and keeps all other 10 players and numbers', () => {
    expect(LAMMENS_FM_PLAYER_ID).toBe('18107436')
    expect(LAMMENS_OVR).toBe(77)
    expect(LAMMENS_POTENTIAL).toBe(83)
    expect(SENNE_LAMMENS.id).toBe('18107436')
    expect(SENNE_LAMMENS.profile.fullName).toBe('Senne Lammens')
    expect(SENNE_LAMMENS.profile.dateOfBirth).toBe('2002-07-07')
    expect(SENNE_LAMMENS.profile.heightCm).toBe(193)
    expect(SENNE_LAMMENS.clubId).toBe('club_man_utd')
    expect(SENNE_LAMMENS.referenceData).toMatchObject({
      externalPlayerId: 18107436, externalClubId: 680,
      overallRating: 77, potentialRating: 83,
      attributeSource: 'user-supplied screenshots',
    })
    expect(FIRST_TEAM.players).toHaveLength(11)
    expect(FIRST_TEAM.players[0]).toEqual(SENNE_LAMMENS)
    expect(FIRST_TEAM.players.filter(p=>p.referenceData)).toHaveLength(4)
    expect(FIRST_TEAM.players.filter(p=>!p.referenceData)).toHaveLength(7)
    expect(FIRST_TEAM.players.some(p=>p.id === 'harbor_senior_01')).toBe(false)
    expect(FIRST_TEAM_SHEET.starters[0]).toMatchObject({
      slot:'GK', playerId:'18107436', shirtNumber:1,
    })
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(p=>p.slot==='GK')).toMatchObject({
      playerId:'18107436', shirtNumber:1,
    })
    expect(FIRST_TEAM_SHEET.starters[7]).toMatchObject({playerId:'43124203',shirtNumber:8})
    expect(FIRST_TEAM_SHEET.starters[9]).toMatchObject({playerId:'62246208',shirtNumber:30})
    expect(new Set(FIRST_TEAM_SHEET.starters.map(p=>p.shirtNumber)).size).toBe(11)
    expect(INITIAL_LOCAL_SQUAD.players[0].id).toBe('18107436')
  })

  it('transcribes every numeric screenshot field and leaves icon-only fields unrated', () => {
    const screenshot = LAMMENS_SCREENSHOT
    const player = SENNE_LAMMENS
    const mappedGoalkeeper = {
      commandOfArea:15, communication:14, handling:16,
      kickingDistribution:14, oneOnOnes:14, reflexes:15, throwingDistribution:12,
    } as const
    for (const [key,rating] of Object.entries(mappedGoalkeeper)) {
      expect(player.abilities.goalkeeping?.[key as keyof typeof mappedGoalkeeper]).toBe(rating*5)
    }
    for (const [key,rating] of Object.entries(screenshot.technical)) {
      const raw=player.abilities.technical[key as keyof typeof screenshot.technical]
      expect(raw).toBe(rating*5)
      expect(toTwenty(raw)).toBe(rating)
    }
    for (const [key,rating] of Object.entries(screenshot.mental)) {
      if (rating === null) continue
      const raw=player.abilities.mental[key as keyof typeof screenshot.mental]
      expect(raw).toBe(rating*5)
      expect(toTwenty(raw)).toBe(rating)
    }
    for (const [key,rating] of Object.entries(screenshot.physical)) {
      const raw=player.abilities.physical[key as keyof typeof screenshot.physical]
      expect(raw).toBe(rating*5)
    }
    expect(toTwenty(readAttribute(player,'hidden.naturalFitness'))).toBe(12)
    expect(screenshot.mental.aggression).toBeNull()
    expect(screenshot.mental.flair).toBeNull()
    expect(screenshot.setPieces.freeKicks).toBeNull()
    expect(screenshot.setPieces.penaltyTaking).toBeNull()
    expect(player.referenceData?.unratedAttributes).toEqual([
      'mental.aggression','mental.flair','technical.freeKicks','technical.penaltyTaking',
    ])
    expect(player.referenceData?.screenshotOnlyRatings).toEqual([
      { category:'goalkeeping',label:'Aerial Reach',score:15 },
      { category:'goalkeeping',label:'Eccentricity',score:4 },
      { category:'goalkeeping',label:'Punching (Tendency)',score:10 },
      { category:'goalkeeping',label:'Rushing Out (Tendency)',score:10 },
    ])
    expect(player.referenceData?.provisionalFields).toContain('abilities.goalkeeping.diving')
    expect(player.referenceData?.provisionalFields).toContain('abilities.mental.aggression')
    expect(player.referenceData?.provisionalFields).toContain('abilities.physical.recovery')
  })

  it('renders the goalie categories and supplementary screenshot data without claiming estimates are sourced', () => {
    const gk = FIRST_TEAM_4231_ASSIGNMENTS.find(p=>p.slot==='GK')!
    const html = renderToStaticMarkup(createElement(PlayerStatsPanel,{
      player:SENNE_LAMMENS, assignment:gk,onClose:()=>{},
    })).replace(/<!-- -->/g,'')
    expect(html).toContain('Senne Lammens')
    expect(html).toContain('77 OVR')
    expect(html).toContain('83 POT')
    expect(html).toContain('FM ID 18107436')
    expect(html).toContain('Goalkeeping')
    expect(html).toContain('Additional FM ratings')
    expect(html).toContain('Aerial Reach')
    expect(html).toContain('Eccentricity')
    expect(html).toContain('Punching (Tendency)')
    expect(html).toContain('Rushing Out (Tendency)')
    expect(categoryRows(SENNE_LAMMENS,'goalkeeping','goalkeeper')).toHaveLength(13)
    expect(SENNE_LAMMENS.abilities.goalkeeping).not.toBeNull()
    expect(SENNE_LAMMENS.abilities.goalkeeping?.handling).toBe(80)
  })

  it('preserves the 4-3-3 match contract and separate 4-2-3-1 preview', () => {
    const old=makeFictionalMatchSetup()
    const result=validateMatchSetup({
      ...old,clubs:[FIRST_TEAM.club,old.clubs[1]],
      teams:[FIRST_TEAM.sheet,old.teams[1]],
      players:[...FIRST_TEAM.players,...old.players.filter(p=>p.clubId===old.clubs[1].id)],
    })
    expect(result.ok, JSON.stringify(result.ok?[]:result.issues)).toBe(true)
    expect(FIRST_TEAM.sheet.formation).toBe('4-3-3')
    expect(INITIAL_LOCAL_SQUAD.lineupPreview.formation).toBe('4-2-3-1')
  })
})
