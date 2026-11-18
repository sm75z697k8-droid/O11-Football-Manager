import { describe, expect, it } from 'vitest'
import { FIRST_TEAM_CLUB, FIRST_TEAM_PLAYERS, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import {
  FIRST_TEAM_4231_ASSIGNMENTS, FIRST_TEAM_4231_POSITIONS,
  FIRST_TEAM_PREVIEW_FORMATION, FORMATION_4231_SLOTS,
} from '../../src/data/first-team-lineup'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { projectPitch, projectPoint } from '../../src/game/viewer/geometry'
import { readFileSync } from 'node:fs'

describe('Man Utd one-half first-team 4-2-3-1', () => {
  it('changes only identity and kit colours, preserving all 11 fictional player records', () => {
    expect(FIRST_TEAM_CLUB).toEqual({
      id: 'club_man_utd', name: 'Man Utd', shortName: 'MUN',
      colors: { primary: '#DA291C', secondary: '#FFFFFF' },
    })
    expect(FIRST_TEAM_PLAYERS).toHaveLength(11)
    expect(FIRST_TEAM_PLAYERS.map(p => p.profile.fullName)).toEqual([
      'Samir Rahman','Ethan Brooks','Leo Bennett','Adil Khan','Mateo Silva',
      'Noah Fletcher','Daniel Mercer','Rafiq Idris','Elias Navarro','Karim Haddad','Lucas Duarte',
    ])
    expect(FIRST_TEAM_PLAYERS.map(p => p.id).every(id => id.startsWith('harbor_senior_'))).toBe(true)
    expect(FIRST_TEAM_PLAYERS.every(p => p.clubId === FIRST_TEAM_CLUB.id)).toBe(true)
    expect(new Set(FIRST_TEAM_PLAYERS.map(p => p.id)).size).toBe(11)
  })

  it('displays genuine 4-2-3-1 lines while preserving the existing 4-3-3 engine sheet', () => {
    expect(FIRST_TEAM_PREVIEW_FORMATION).toBe('4-2-3-1')
    expect(FIRST_TEAM_SHEET.formation).toBe('4-3-3')
    expect(FORMATION_4231_SLOTS).toHaveLength(11)
    expect(FIRST_TEAM_4231_ASSIGNMENTS).toHaveLength(11)
    expect(new Set(FIRST_TEAM_4231_ASSIGNMENTS.map(p => p.slot)).size).toBe(11)
    expect(new Set(FIRST_TEAM_4231_ASSIGNMENTS.map(p => p.playerId)).size).toBe(11)
    expect(FIRST_TEAM_4231_ASSIGNMENTS.map(a => a.playerId)).toEqual(
      FIRST_TEAM_SHEET.starters.map(a => a.playerId),
    )
    const slotNames = FIRST_TEAM_4231_ASSIGNMENTS.map(a => a.slot)
    expect(slotNames.filter(s => ['RB','RCB','LCB','LB'].includes(s))).toHaveLength(4)
    expect(slotNames.filter(s => ['RDM','LDM'].includes(s))).toHaveLength(2)
    expect(slotNames.filter(s => ['RW','CAM','LW'].includes(s))).toHaveLength(3)
    expect(slotNames.filter(s => s === 'ST')).toHaveLength(1)
    const cam = FIRST_TEAM_4231_ASSIGNMENTS.find(x => x.slot === 'CAM')
    expect(cam?.shirtNumber).toBe(10)
    expect(cam?.role).toBe('attackingMidfielder')
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(x=>x.slot==='RDM')?.shirtNumber).toBe(6)
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(x=>x.slot==='LDM')?.shirtNumber).toBe(8)
  })

  it('keeps all 11 markers to the left of the halfway line at iPhone and desktop sizes', () => {
    for (const [width,height] of [[844,390],[390,844],[1280,720]]) {
      const projection = projectPitch(width,height,DEFAULT_PITCH)
      const midway = projection.x + projection.width / 2
      for (const player of FIRST_TEAM_4231_ASSIGNMENTS) {
        expect(player.position).toEqual(FIRST_TEAM_4231_POSITIONS[player.slot])
        expect(player.position.xM).toBeGreaterThan(0)
        expect(player.position.xM).toBeLessThan(DEFAULT_PITCH.lengthM / 2)
        const drawn = projectPoint(player.position,projection)
        expect(drawn.x).toBeLessThan(midway)
        expect(drawn.y).toBeGreaterThan(projection.y)
        expect(drawn.y).toBeLessThan(projection.y + projection.height)
      }
    }
  })

  it('uses red shirts with white sleeves without fetching an external licensed jersey', () => {
    const css = readFileSync('src/app/FirstTeamPreview.css','utf8')
    expect(css).toContain('.first-team-marker-shirt')
    expect(css).toContain('#cb1729')
    expect(css).toContain('#f7f9fd')
    expect(css).not.toContain('.first-team-marker-disc')
  })
})
