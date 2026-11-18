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

  it('keeps both white roof planes behind the goals and off the pitch', () => {
    const width = 844
    const height = 390
    const pitch = projectPitch(width, height, DEFAULT_PITCH)
    const roofPolygons: Array<Array<{ x: number; y: number }>> = []
    let path: Array<{ x: number; y: number }> = []
    let paint: unknown

    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => {
        const colors: string[] = []
        return { colors, addColorStop: (_offset: number, color: string) => { colors.push(color) } }
      },
      fillRect: () => {},
      beginPath: () => { path = [] },
      moveTo: (x: number, y: number) => { path.push({ x, y }) },
      lineTo: (x: number, y: number) => { path.push({ x, y }) },
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => {
        if (paint && typeof paint === 'object' && 'colors' in paint &&
          (paint as { colors: string[] }).colors.includes('#f5f8f6')) {
          roofPolygons.push([...path])
        }
      },
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => paint,
      set: (value: unknown) => { paint = value },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    expect(roofPolygons).toHaveLength(2)
    expect(roofPolygons[0].every(({ x }) => x < pitch.x)).toBe(true)
    expect(roofPolygons[1].every(({ x }) => x > pitch.x + pitch.width)).toBe(true)
    expect(roofPolygons.flat().every(({ x, y }) =>
      Number.isFinite(x) && y >= 0 && y <= height)).toBe(true)
  })
})
