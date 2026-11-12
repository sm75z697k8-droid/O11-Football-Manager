import { describe, expect, it } from 'vitest'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  findPlayerAt, interpolatePosition, projectPitch, projectPoint,
} from '../../src/game/viewer/geometry'

describe('Phase 6 world-to-canvas projection', () => {
  it('preserves the physical field aspect ratio across landscape and portrait sizes', () => {
    for (const [width, height] of [[850, 360], [1400, 900], [320, 640], [320, 200]] as const) {
      const p = projectPitch(width, height, DEFAULT_PITCH)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.width).toBeLessThanOrEqual(width)
      expect(p.y + p.height).toBeLessThanOrEqual(height)
      expect(p.width / p.height).toBeCloseTo(105 / 68, 10)
    }
  })

  it('maps real metric field corners and centre precisely into pixels', () => {
    const p = projectPitch(844, 290, DEFAULT_PITCH)
    expect(projectPoint({ xM: 0, yM: 0 }, p)).toEqual({ x: p.x, y: p.y })
    expect(projectPoint({ xM: 52.5, yM: 34 }, p).x).toBeCloseTo(422, 9)
    expect(projectPoint({ xM: 52.5, yM: 34 }, p).y).toBeCloseTo(145, 9)
    expect(projectPoint({ xM: 105, yM: 68 }, p).x).toBeCloseTo(p.x + p.width, 9)
    expect(projectPoint({ xM: 105, yM: 68 }, p).y).toBeCloseTo(p.y + p.height, 9)
  })

  it('hit-tests real player locations, returning the nearest physical footballer', () => {
    const state = createFoundationMatch(makeFictionalMatchSetup()).getState()
    const projection = projectPitch(1000, 620, DEFAULT_PITCH)
    const player = state.players[9]
    const point = projectPoint(player.position, projection)
    expect(findPlayerAt(point, state, projection)).toBe(player.playerId)
    expect(findPlayerAt({ x: -90, y: -90 }, state, projection)).toBeNull()
  })

  it('interpolates two actual physical states with clamped alpha', () => {
    const a = { xM: 10, yM: 7 }
    const b = { xM: 30, yM: 11 }
    expect(interpolatePosition(a, b, 0)).toEqual(a)
    expect(interpolatePosition(a, b, 1)).toEqual(b)
    expect(interpolatePosition(a, b, .25)).toEqual({ xM: 15, yM: 8 })
    expect(interpolatePosition(a, b, -2)).toEqual(a)
    expect(interpolatePosition(a, b, 4)).toEqual(b)
  })
})
