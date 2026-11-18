import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StadiumOnly from '../../src/app/StadiumOnly'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { projectPitch } from '../../src/game/viewer/geometry'
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

  it('recolors the original two goal-end terraces white without adding canopy polygons', () => {
    const viewportWidth = 844
    const viewportHeight = 390
    const pitch = projectPitch(viewportWidth, viewportHeight, DEFAULT_PITCH)
    const gradients: Array<{ stops: string[] }> = []
    const terraceRects: Array<{ x: number; y: number; w: number; h: number; stops: string[] }> = []
    let paint: unknown
    let outlinedSegments = 0
    let filledPolygonCount = 0

    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => {
        const gradient = { stops: [] as string[],
          addColorStop: (_offset: number, color: string) => { gradient.stops.push(color) } }
        gradients.push(gradient)
        return gradient
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        if (paint && typeof paint === 'object' && 'stops' in paint) {
          terraceRects.push({ x, y, w, h, stops: (paint as { stops: string[] }).stops })
        }
      },
      beginPath: () => { outlinedSegments = 0 },
      moveTo: () => { outlinedSegments += 1 },
      lineTo: () => { outlinedSegments += 1 },
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => { if (outlinedSegments > 0) filledPolygonCount += 1 },
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => paint,
      set: (value: unknown) => { paint = value },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, viewportWidth, viewportHeight)
    expect(gradients).toHaveLength(3) // backdrop and original two stands
    const whiteTerraces = terraceRects.filter(rect => rect.stops.includes('#f6f8f5'))
    expect(whiteTerraces).toHaveLength(2)
    expect(whiteTerraces[0]).toMatchObject({ x: 0, y: 0, w: pitch.x, h: viewportHeight })
    expect(whiteTerraces[1].x).toBeCloseTo(pitch.x + pitch.width)
    expect(whiteTerraces[1].w).toBeCloseTo(pitch.x)
    expect(whiteTerraces[1].h).toBe(viewportHeight)
    expect(filledPolygonCount).toBe(0) // no canopy sheets
  })
})
