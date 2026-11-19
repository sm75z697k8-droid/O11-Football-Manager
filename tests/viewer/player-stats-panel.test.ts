import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PlayerStatsPanel from '../../src/app/PlayerStatsPanel'
import { FIRST_TEAM_PLAYERS, FIRST_TEAM_SHEET } from '../../src/data/first-team'
import { toTwenty } from '../../src/game/model/attribute-profile'

describe('first-team attribute categories on iPhone', () => {
  const noOp = () => {}
  it('shows technical/mental/physical/set pieces from the same player data', () => {
    const player = FIRST_TEAM_PLAYERS[9]
    const assignment = FIRST_TEAM_SHEET.starters[9]
    const html = renderToStaticMarkup(createElement(PlayerStatsPanel, {
      player, assignment, onClose: noOp,
    }))
    expect(html).toContain('Benjamin Šeško')
    expect(html).toContain('Technical')
    expect(html).toContain('Mental')
    expect(html).toContain('Physical')
    expect(html).toContain('Set Pieces')
    expect(html).toContain('Attribute profile')
    expect(html).toContain('Crossing')
    expect(html).toContain('Finishing')
    expect(html).toContain(String(toTwenty(player.abilities.technical.finishing)))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('Close player attributes')
    expect(html).not.toContain('goalkeeping</button>')
  })
  it('starts with actual goalkeeper skills when a keeper is selected', () => {
    const player = FIRST_TEAM_PLAYERS[0]
    const assignment = FIRST_TEAM_SHEET.starters[0]
    const html = renderToStaticMarkup(createElement(PlayerStatsPanel, {
      player, assignment, onClose: noOp,
    }))
    expect(html).toContain('Samir Rahman')
    expect(html).toContain('Goalkeeping')
    expect(html).toContain('Reflexes')
    expect(html).toContain('Handling')
    expect(html).toContain('Command of Area')
    expect(html).toContain('aria-selected="true"')
  })
})
