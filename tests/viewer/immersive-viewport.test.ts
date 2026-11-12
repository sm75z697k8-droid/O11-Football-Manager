import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../../src/data/fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import {
  findPlayerAt, projectPitch, projectPoint,
} from '../../src/game/viewer/geometry'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'

describe('Full-screen, geometrically correct O11 pitch projection', () => {
  const setup = makeFictionalMatchSetup()
  const state = createFoundationMatch(setup).getState()

  it('uses nearly the entire available landscape height without cropping the field', () => {
    for (const [width, height] of [
      [844, 390], [667, 375], [1024, 768], [1366, 768],
    ] as const) {
      const view = projectPitch(width, height, setup.pitch)
      expect(view.height).toBeGreaterThan(0)
      expect(view.height).toBeLessThanOrEqual(height)
      expect(view.x).toBeGreaterThanOrEqual(0)
      expect(view.y).toBeGreaterThanOrEqual(0)
      expect(view.x + view.width).toBeLessThanOrEqual(width)
      expect(view.y + view.height).toBeLessThanOrEqual(height)
      expect(view.width / view.height).toBeCloseTo(105 / 68, 9)
      // There is no side panel or permanent header stealing canvas height.
      if (width / height > 105 / 68) {
        expect(view.height / height).toBeGreaterThan(.95)
      }
    }
  })

  it('keeps all 22 player markers on-screen and selectable using identical coordinates', () => {
    for (const [width, height] of [[844, 390], [667, 375], [1366, 768]] as const) {
      const projection = projectPitch(width, height, setup.pitch)
      const allPlayers = state.players.map(player => {
        const point = projectPoint(player.position, projection)
        expect(point.x).toBeGreaterThanOrEqual(projection.x)
        expect(point.x).toBeLessThanOrEqual(projection.x + projection.width)
        expect(point.y).toBeGreaterThanOrEqual(projection.y)
        expect(point.y).toBeLessThanOrEqual(projection.y + projection.height)
        return player
      })
      expect(allPlayers).toHaveLength(22)
      // Screen hit testing must not introduce an independent geometry model.
      const striker = state.players[9]
      expect(findPlayerAt(
        projectPoint(striker.position, projection), state, projection,
      )).toBe(striker.playerId)
    }
  })

  it('keeps the ball and field within metric physics rather than made-up visual coordinates', () => {
    const ball = state.ball
    expect(ball.heightM).toBe(BALL_RADIUS_M)
    expect(ball.position).toEqual({
      xM: setup.pitch.lengthM / 2,
      yM: setup.pitch.widthM / 2,
    })
    const projection = projectPitch(844, 390, setup.pitch)
    const centre = projectPoint(ball.position, projection)
    expect(centre.x).toBeCloseTo(422, 8)
    expect(centre.y).toBeCloseTo(195, 8)
  })
})
