import { describe, expect, it } from 'vitest'
import { FIRST_TEAM_CLUB, FIRST_TEAM_PLAYERS, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import {
  FIRST_TEAM_4231_ASSIGNMENTS, FIRST_TEAM_4231_POSITIONS,
  FIRST_TEAM_PREVIEW_FORMATION, FORMATION_4231_SLOTS,
} from '../../src/data/first-team-lineup'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { facingAngleDegrees, projectPitch, projectPoint } from '../../src/game/viewer/geometry'
import { readFileSync } from 'node:fs'

describe('Man Utd one-half first-team 4-2-3-1', () => {
  it('includes Bruno and Šeško, preserving nine fictional players', () => {
    expect(FIRST_TEAM_CLUB).toEqual({
      id: 'club_man_utd', name: 'Man Utd', shortName: 'MUN', fmUid: 680,
      colors: { primary: '#DA291C', secondary: '#FFFFFF' },
    })
    expect(FIRST_TEAM_PLAYERS).toHaveLength(11)
    expect(FIRST_TEAM_PLAYERS.map(p => p.profile.fullName)).toEqual([
      'Samir Rahman','Ethan Brooks','Leo Bennett','Adil Khan','Mateo Silva',
      'Noah Fletcher','Daniel Mercer','Bruno Fernandes','Elias Navarro','Benjamin Šeško','Lucas Duarte',
    ])
    expect(FIRST_TEAM_PLAYERS.filter(p => p.id.startsWith('harbor_senior_'))).toHaveLength(9)
    expect(FIRST_TEAM_PLAYERS[7].id).toBe('43124203')
    expect(FIRST_TEAM_PLAYERS[7].referenceData?.overallRating).toBe(89)
    expect(FIRST_TEAM_PLAYERS[7].referenceData?.potentialRating).toBe(89)
    expect(FIRST_TEAM_PLAYERS[9].id).toBe('62246208')
    expect(FIRST_TEAM_PLAYERS[9].referenceData?.overallRating).toBe(75)
    expect(FIRST_TEAM_PLAYERS[9].referenceData?.potentialRating).toBe(85)
    expect(FIRST_TEAM_PLAYERS[6].id).toBe('harbor_senior_08')
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
    expect(cam?.shirtNumber).toBe(8)
    expect(cam?.role).toBe('attackingMidfielder')
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(x=>x.slot==='RDM')?.shirtNumber).toBe(6)
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(x=>x.slot==='LDM')?.shirtNumber).toBe(10)
    expect(FIRST_TEAM_4231_ASSIGNMENTS.find(x=>x.slot==='ST')?.shirtNumber).toBe(30)
    expect(new Set(FIRST_TEAM_4231_ASSIGNMENTS.map(a=>a.shirtNumber)).size).toBe(11)
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

  it('derives a facing direction from pitch coordinates, not an invented live AI state', () => {
    expect(facingAngleDegrees({ xM: 30, yM: 34 }, { xM: 105, yM: 34 })).toBeCloseTo(0)
    expect(facingAngleDegrees({ xM: 90, yM: 34 }, { xM: 0, yM: 34 })).toBeCloseTo(180)
    expect(facingAngleDegrees({ xM: 10, yM: 10 }, { xM: 10, yM: 25 })).toBeCloseTo(90)
    expect(facingAngleDegrees({ xM: 10, yM: 25 }, { xM: 10, yM: 10 })).toBeCloseTo(-90)
    expect(facingAngleDegrees({ xM: 5, yM: 5 }, { xM: 5, yM: 5 })).toBe(0)
    const goal = { xM: DEFAULT_PITCH.lengthM, yM: DEFAULT_PITCH.widthM / 2 }
    const playerHeadings = FIRST_TEAM_4231_ASSIGNMENTS.map(p => facingAngleDegrees(p.position, goal))
    expect(playerHeadings).toHaveLength(11)
    expect(playerHeadings.every(h => h > -45 && h < 45)).toBe(true)
    // Players above and below the centre line should angle toward the same goal.
    expect(facingAngleDegrees(FIRST_TEAM_4231_POSITIONS.LW, goal)).toBeGreaterThan(0)
    expect(facingAngleDegrees(FIRST_TEAM_4231_POSITIONS.RW, goal)).toBeLessThan(0)
  })

  it('uses smaller circular red markers with a gold heading pointer, not jerseys', () => {
    const css = readFileSync('src/app/FirstTeamPreview.css','utf8')
    const component = readFileSync('src/app/FirstTeamPreview.tsx','utf8')
    expect(css).toContain('.first-team-marker-disc')
    expect(css).toContain('border-radius: 50%')
    expect(css).toContain('background: #DA291C')
    expect(css).toContain('border: 2px solid #FFFFFF')
    expect(css).toContain('color: #FFFFFF')
    expect(css).toContain('.first-team-marker--selected .first-team-marker-disc')
    expect(component).toContain('className="first-team-marker-disc"')
    expect(css).toContain('width: 23px')
    expect(css).toContain('width: 21px')
    expect(css).toContain('min-width: 44px')
    expect(css).toContain('.first-team-marker-facing::after')
    expect(css).toContain('border-left: 6px solid #ffe39a')
    expect(component).toContain('style={directionStyle}')
    expect(component).toContain('{starter.shirtNumber}')
    expect(component).not.toContain('first-team-marker-shirt')
    expect(css).not.toContain('clip-path: polygon')
  })
})
