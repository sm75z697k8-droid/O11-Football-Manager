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
      expect(left.w).toBeGreaterThan(projection.x)
      expect(left.w - projection.x).toBeLessThanOrEqual(12)
      expect(right.x).toBeLessThan(projection.x + projection.width)
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
