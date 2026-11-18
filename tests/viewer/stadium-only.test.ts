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

  it('matches the reference: three white horizontal roof bays behind each goal', () => {
    const width = 844
    const height = 390
    const pitch = projectPitch(width, height, DEFAULT_PITCH)
    const whitePanels: Array<{ x: number; y: number; w: number; h: number }> = []
    const beams: Array<Array<{ x: number; y: number }>> = []
    let fillPaint: unknown
    let path: Array<{ x: number; y: number }> = []

    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => {
        const stops: string[] = []
        return { stops, addColorStop: (_offset: number, color: string) => { stops.push(color) } }
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        if (fillPaint && typeof fillPaint === 'object' && 'stops' in fillPaint &&
          (fillPaint as { stops: string[] }).stops.includes('#eeeeed')) {
          whitePanels.push({ x, y, w, h })
        }
      },
      beginPath: () => { path = [] },
      moveTo: (x: number, y: number) => { path.push({ x, y }) },
      lineTo: (x: number, y: number) => { path.push({ x, y }) },
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => {
        if (fillPaint && typeof fillPaint === 'object' && 'stops' in fillPaint &&
          (fillPaint as { stops: string[] }).stops.includes('#ffffff')) {
          beams.push([...path])
        }
      },
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => fillPaint,
      set: (value: unknown) => { fillPaint = value },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    expect(whitePanels).toHaveLength(6)
    expect(beams).toHaveLength(6)
    const leftPanels = whitePanels.slice(0, 3)
    const rightPanels = whitePanels.slice(3)
    expect(leftPanels.every(panel => panel.x === 0 && panel.w === pitch.x)).toBe(true)
    expect(rightPanels.every(panel => panel.x >= pitch.x + pitch.width)).toBe(true)
    expect(whitePanels.every(panel => panel.y >= 0 && panel.y + panel.h <= height)).toBe(true)

    // Beam polygons must stay entirely behind the goals on either side.
    for (const beam of beams.slice(0, 3)) {
      expect(beam.length).toBe(4)
      expect(beam.every(({ x }) => x <= pitch.x)).toBe(true)
    }
    for (const beam of beams.slice(3)) {
      expect(beam.length).toBe(4)
      expect(beam.every(({ x }) => x >= pitch.x + pitch.width)).toBe(true)
    }
    // Main tier divisions follow the supplied screenshot's proportions.
    expect(leftPanels[0].h).toBeCloseTo(height * 0.28)
    expect(leftPanels[1].h).toBeCloseTo(height * 0.44)
    expect(leftPanels[2].h).toBeCloseTo(height * 0.28)
  })
})
