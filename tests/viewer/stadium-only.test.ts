import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StadiumOnly from '../../src/app/StadiumOnly'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
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
})
