import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FirstTeamPreview from '../../src/app/FirstTeamPreview'
import {
  FIRST_TEAM_CLUB, FIRST_TEAM_PLAYERS, FIRST_TEAM_POSITIONS, FIRST_TEAM_SHEET,
} from '../../src/data/first-team'
import { makeFictionalMatchSetup } from '../../src/data/fixtures/fictional-match'
import { validateMatchSetup } from '../../src/data/validate'
import { projectPitch, projectPoint } from '../../src/game/viewer/geometry'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { FORMATION_433_SLOTS } from '../../src/game/model/team'

describe('first senior team', () => {
  it('creates a complete fictional 4-3-3 with unique players and shirt numbers', () => {
    expect(FIRST_TEAM_CLUB.name).toBe('Man Utd')
    expect(FIRST_TEAM_SHEET.clubId).toBe(FIRST_TEAM_CLUB.id)
    expect(FIRST_TEAM_SHEET.formation).toBe('4-3-3')
    expect(FIRST_TEAM_PLAYERS).toHaveLength(11)
    expect(FIRST_TEAM_SHEET.starters).toHaveLength(11)
    expect(FIRST_TEAM_SHEET.starters.map(s => s.slot)).toEqual(FORMATION_433_SLOTS)
    expect(new Set(FIRST_TEAM_PLAYERS.map(p => p.id)).size).toBe(11)
    expect(new Set(FIRST_TEAM_SHEET.starters.map(p => p.shirtNumber)).size).toBe(11)
    expect(FIRST_TEAM_PLAYERS.every(p => p.clubId === FIRST_TEAM_CLUB.id)).toBe(true)
    expect(FIRST_TEAM_PLAYERS.every(p => !/Player \d+/.test(p.profile.fullName))).toBe(true)
    const keeper = FIRST_TEAM_PLAYERS.find(p => p.id === FIRST_TEAM_SHEET.starters[0].playerId)
    expect(keeper?.abilities.goalkeeping?.reflexes).toBeGreaterThan(70)
    expect(FIRST_TEAM_PLAYERS.slice(1).every(p => p.abilities.goalkeeping === null)).toBe(true)
    expect(FIRST_TEAM_PLAYERS.some(p => p.abilities.technical.finishing > 80)).toBe(true)
  })

  it('integrates into the existing strictly validated two-team match contract', () => {
    const legacy = makeFictionalMatchSetup()
    const replacement = {
      ...legacy,
      clubs: [FIRST_TEAM_CLUB, legacy.clubs[1]],
      teams: [FIRST_TEAM_SHEET, legacy.teams[1]],
      players: [...FIRST_TEAM_PLAYERS, ...legacy.players.filter(p => p.clubId === legacy.clubs[1].id)],
    }
    const validated = validateMatchSetup(replacement)
    expect(validated.ok).toBe(true)
  })

  it('projects all 11 preview positions inside the actual pitch and preserves the stadium screen', () => {
    for (const [w, h] of [[844,390], [390,844], [1280,720]]) {
      const projection = projectPitch(w, h, DEFAULT_PITCH)
      const points = FORMATION_433_SLOTS.map(slot => projectPoint(FIRST_TEAM_POSITIONS[slot], projection))
      expect(points).toHaveLength(11)
      for (const p of points) {
        expect(p.x).toBeGreaterThan(projection.x)
        expect(p.x).toBeLessThan(projection.x + projection.width)
        expect(p.y).toBeGreaterThan(projection.y)
        expect(p.y).toBeLessThan(projection.y + projection.height)
      }
    }
    const html = renderToStaticMarkup(createElement(FirstTeamPreview))
    expect(html).toContain('Man Utd')
    expect(html).toContain('Fictional players')
    expect(html).toContain('4-2-3-1')
    expect(html).toContain('Football stadium and pitch beneath a fictional starting eleven')
    expect(html).not.toContain('match-scoreboard')
  })
})
