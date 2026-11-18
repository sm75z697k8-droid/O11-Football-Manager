import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StadiumOnly from '../../src/app/StadiumOnly'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { GOAL_END_RUNOFF_M, TOUCHLINE_RUNOFF_M, projectPitch } from '../../src/game/viewer/geometry'
import { renderStadiumOnly } from '../../src/game/viewer/renderer'

describe('stadium-only entry screen', () => {
  it('mounts only an accessible static Canvas, without match controls', () => {
    const html = renderToStaticMarkup(createElement(StadiumOnly))
    expect(html).toContain('<canvas')
    expect(html).toContain('Empty football stadium')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('match-scoreboard')
    expect(html).not.toContain('floating-transport')
  })

  it('renders pitch markings and stadium stands without a simulated match', () => {
    const operations: string[] = []
    const ctx = {
      clearRect: () => operations.push('clearRect'),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => operations.push('fillRect'),
      beginPath: () => operations.push('beginPath'),
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => operations.push('stroke'),
      strokeRect: () => operations.push('strokeRect'),
      arc: () => operations.push('arc'),
      fill: () => operations.push('fill'),
    } as unknown as CanvasRenderingContext2D

    renderStadiumOnly(ctx, DEFAULT_PITCH, 844, 390)
    expect(operations[0]).toBe('clearRect')
    expect(operations.filter(op => op === 'fillRect').length).toBeGreaterThan(40)
    // Only four fixed pitch arcs: centre circle and three ground spots.
    // Player and ball rendering is deliberately never invoked.
    expect(operations.filter(op => op === 'arc')).toHaveLength(4)
  })

  it('keeps white markings inside green grass and reserves 2m net run-off', () => {
    const width = 844
    const height = 390
    const projection = projectPitch(width, height, DEFAULT_PITCH)
    const grassRects: Array<{ x: number; y: number; w: number; h: number }> = []
    const markingRects: Array<{ x: number; y: number; w: number; h: number }> = []
    let style: unknown
    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillRect: (x: number, y: number, w: number, h: number) => {
        if (style === '#2a6a42') grassRects.push({ x, y, w, h })
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      strokeRect: (x: number, y: number, w: number, h: number) => {
        if (style === 'rgba(234,255,236,0.76)') markingRects.push({ x, y, w, h })
      },
      arc: () => {},
      fill: () => {},
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => style,
      set: (value: unknown) => { style = value },
    })
    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    expect(grassRects).toHaveLength(1)
    const grass = grassRects[0]
    const goalSpace = GOAL_END_RUNOFF_M * projection.scale
    const sideSpace = TOUCHLINE_RUNOFF_M * projection.scale
    expect(grass.x).toBeCloseTo(projection.x - goalSpace)
    expect(grass.w).toBeCloseTo(projection.width + goalSpace * 2)
    expect(grass.y).toBeCloseTo(projection.y - sideSpace)
    expect(grass.h).toBeCloseTo(projection.height + sideSpace * 2)
    expect(goalSpace).toBeGreaterThan(2 * projection.scale)
    expect(markingRects[0]).toEqual({
      x: projection.x, y: projection.y,
      w: projection.width, h: projection.height,
    })
  })

  it('uses the same checkerboard turf across the larger goal and touchline run-offs', () => {
    expect(GOAL_END_RUNOFF_M).toBeGreaterThanOrEqual(8)
    expect(TOUCHLINE_RUNOFF_M).toBeGreaterThanOrEqual(3)

    const width = 844
    const height = 390
    const pitch = projectPitch(width, height, DEFAULT_PITCH)
    const turf: Array<{ x: number; y: number; w: number; h: number }> = []
    const tiles: Array<{ x: number; y: number; w: number; h: number }> = []
    let paint: unknown

    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillRect: (x: number, y: number, w: number, h: number) => {
        if (paint === '#2a6a42') turf.push({ x, y, w, h })
        if (paint === '#317449') tiles.push({ x, y, w, h })
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => {},
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => paint,
      set: (value: unknown) => { paint = value },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    expect(turf).toHaveLength(1)
    const grass = turf[0]
    const right = grass.x + grass.w
    const bottom = grass.y + grass.h
    const tolerance = 1e-8
    // Both sides of the legal pitch and both touchlines have the same
    // alternating mowing pattern, rather than a flat differently shaded strip.
    expect(tiles.some(tile => tile.x < pitch.x)).toBe(true)
    expect(tiles.some(tile => tile.x + tile.w > pitch.x + pitch.width)).toBe(true)
    expect(tiles.some(tile => tile.y < pitch.y)).toBe(true)
    expect(tiles.some(tile => tile.y + tile.h > pitch.y + pitch.height)).toBe(true)
    expect(tiles.some(tile => tile.x >= pitch.x && tile.y >= pitch.y)).toBe(true)
    expect(tiles.every(tile =>
      tile.x >= grass.x - tolerance && tile.y >= grass.y - tolerance &&
      tile.x + tile.w <= right + tolerance &&
      tile.y + tile.h <= bottom + tolerance)).toBe(true)
  })

  it('renders three evenly spaced mirrored beams above the pitch edges', () => {
    const width = 844
    const height = 390
    const projection = projectPitch(width, height, DEFAULT_PITCH)
    const panels: Array<{ x: number; y: number; w: number; h: number }> = []
    const beams: Array<Array<{ x: number; y: number }>> = []
    const drawOrder: string[] = []
    let paint: unknown
    let path: Array<{ x: number; y: number }> = []
    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => {
        const stops: string[] = []
        return { stops, addColorStop: (_offset: number, color: string) => { stops.push(color) } }
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        if (paint === '#2a6a42') drawOrder.push('pitch')
        if (paint && typeof paint === 'object' && 'stops' in paint &&
          (paint as { stops: string[] }).stops.includes('#eeeeed')) {
          panels.push({ x, y, w, h })
          drawOrder.push('roof')
        }
      },
      beginPath: () => { path = [] },
      moveTo: (x: number, y: number) => { path.push({ x, y }) },
      lineTo: (x: number, y: number) => { path.push({ x, y }) },
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => {
        if (paint && typeof paint === 'object' && 'stops' in paint &&
          (paint as { stops: string[] }).stops.includes('#ffffff')) {
          beams.push([...path])
        }
      },
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => paint,
      set: (value: unknown) => { paint = value },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    // The painted grass is larger than the legal marked pitch, as in the
    // reference. Roof fascia stops behind each legal goal line.
    expect(drawOrder[0]).toBe('pitch')
    expect(drawOrder.slice(1)).toEqual(Array(8).fill('roof'))
    expect(panels).toHaveLength(8) // four equal roof panels per end
    expect(beams).toHaveLength(6) // three support beams per end
    for (let i = 0; i < 4; i++) {
      const left = panels[i]
      const right = panels[i + 4]
      expect(left.y).toBe(height * i / 4)
      expect(left.h).toBe(height / 4)
      expect(right.y).toBe(left.y)
      expect(right.h).toBe(left.h)
      expect(left.x).toBe(0)
      expect(right.x + right.w).toBeCloseTo(width)
      expect(right.w).toBeCloseTo(left.w)
      const goalLineLeft = projection.x
      const goalLineRight = projection.x + projection.width
      const netDepth = 2 * projection.scale
      // Roofs are set back behind the marked lines, leaving net space.
      expect(left.x + left.w).toBeLessThan(goalLineLeft - netDepth)
      expect(right.x).toBeGreaterThan(goalLineRight + netDepth)
      expect(right.w).toBeCloseTo(left.w)
    }
    for (let i = 0; i < 3; i++) {
      const left = beams[i]
      const right = beams[i + 3]
      expect(left).toHaveLength(4)
      expect(right).toHaveLength(4)
      for (let j = 0; j < 4; j++) {
        expect(left[j].x + right[j].x).toBeCloseTo(width)
        expect(left[j].y).toBeCloseTo(right[j].y)
      }
      const thickness = Math.max(4, Math.min(10, height * 0.017))
      expect(left[0].y).toBeCloseTo(height * (i + 1) / 4 - thickness * 0.22)
    }
  })
})
