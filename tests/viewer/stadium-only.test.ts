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
      quadraticCurveTo: () => {},
      closePath: () => {},
      clip: () => {},
      save: () => {},
      restore: () => {},
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
      quadraticCurveTo: () => {},
      closePath: () => {},
      clip: () => {},
      save: () => {},
      restore: () => {},
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

  it('draws twelve alternating pitch stripes, light turf grain, and plain outer run-off', () => {
    expect(GOAL_END_RUNOFF_M).toBeGreaterThanOrEqual(8)
    expect(TOUCHLINE_RUNOFF_M).toBeGreaterThanOrEqual(3)
    const width = 844
    const height = 390
    const pitch = projectPitch(width, height, DEFAULT_PITCH)
    const rectangles: Array<{ x: number; y: number; w: number; h: number; style: unknown }> = []
    let style: unknown
    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillRect: (x: number, y: number, w: number, h: number) => {
        rectangles.push({ x, y, w, h, style })
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      closePath: () => {},
      clip: () => {},
      save: () => {},
      restore: () => {},
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => {},
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => style,
      set: (value: unknown) => { style = value },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    const outer = rectangles.filter(r => r.style === '#2a6a42')
    const stripes = rectangles.filter(r => r.style === '#32774a' || r.style === '#2d6d43')
    const grain = rectangles.filter(r => r.style === 'rgba(218, 242, 221, 0.060)' ||
      r.style === 'rgba(11, 49, 28, 0.075)')
    expect(outer).toHaveLength(1)
    expect(stripes).toHaveLength(12)
    expect(grain.length).toBeGreaterThan(80)
    expect(grain.length).toBeLessThanOrEqual(448)

    const goalRunoff = GOAL_END_RUNOFF_M * pitch.scale
    const touchlineRunoff = TOUCHLINE_RUNOFF_M * pitch.scale
    expect(outer[0].x).toBeCloseTo(pitch.x - goalRunoff)
    expect(outer[0].y).toBeCloseTo(pitch.y - touchlineRunoff)
    expect(outer[0].w).toBeCloseTo(pitch.width + 2 * goalRunoff)
    expect(outer[0].h).toBeCloseTo(pitch.height + 2 * touchlineRunoff)

    // No stripes or grain on the outer run-off, including behind the nets.
    const inside = (r: { x: number; y: number; w: number; h: number }) =>
      r.x >= pitch.x - 1e-8 && r.y >= pitch.y - 1e-8 &&
      r.x + r.w <= pitch.x + pitch.width + 1e-8 &&
      r.y + r.h <= pitch.y + pitch.height + 1e-8
    expect(stripes.every(inside)).toBe(true)
    expect(grain.every(inside)).toBe(true)
    expect(stripes.map(r => r.style)).toEqual(Array.from({ length: 12 },
      (_, i) => i % 2 === 0 ? '#32774a' : '#2d6d43'))
    for (let i = 0; i < 12; i += 1) {
      expect(stripes[i].x).toBeCloseTo(pitch.x + i * pitch.width / 12)
      expect(stripes[i].w).toBeCloseTo(pitch.width / 12)
      expect(stripes[i].y).toBeCloseTo(pitch.y)
      expect(stripes[i].h).toBeCloseTo(pitch.height)
    }
  })

  it('rounds the green stadium opening at all four corners as sketched', () => {
    const width = 844
    const height = 390
    const pitch = projectPitch(width, height, DEFAULT_PITCH)
    const outlines: Array<Array<{ op: string; coords: number[] }>> = []
    const roofPanels: Array<{ x: number; y: number; w: number; h: number }> = []
    let path: Array<{ op: string; coords: number[] }> = []
    let paint: unknown
    let saved = 0
    let restored = 0
    const ctx = {
      clearRect: () => {},
      createLinearGradient: () => {
        const stops: string[] = []
        return { stops, addColorStop: (_offset: number, color: string) => { stops.push(color) } }
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        if (paint && typeof paint === 'object' && 'stops' in paint &&
          (paint as { stops: string[] }).stops.includes('#eeeeed')) {
          roofPanels.push({ x, y, w, h })
        }
      },
      beginPath: () => { path = [] },
      moveTo: (x: number, y: number) => { path.push({ op: 'M', coords: [x, y] }) },
      lineTo: (x: number, y: number) => { path.push({ op: 'L', coords: [x, y] }) },
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
        path.push({ op: 'Q', coords: [cx, cy, x, y] })
      },
      closePath: () => { path.push({ op: 'Z', coords: [] }) },
      clip: () => { outlines.push([...path]) },
      save: () => { saved++ },
      restore: () => { restored++ },
      stroke: () => {},
      strokeRect: () => {},
      arc: () => {},
      fill: () => {},
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => paint,
      set: (next: unknown) => { paint = next },
    })

    renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    expect(saved).toBe(2)
    expect(restored).toBe(2)
    expect(outlines).toHaveLength(2)
    expect(roofPanels).toHaveLength(8)
    const [left, right] = outlines
    for (const shape of outlines) {
      expect(shape.at(-1)?.op).toBe('Z')
      const curves = shape.filter(p => p.op === 'Q')
      expect(curves).toHaveLength(2)
      const tip = shape.find(p => p.op === 'L' && p.coords[1] === 0)
      expect(tip).toBeDefined()
      const innerX = curves[0].coords[2]
      const cornerHeight = curves[0].coords[3]
      expect(cornerHeight).toBeGreaterThan(height * 0.15)
      expect(cornerHeight).toBeLessThan(height * 0.21)
      expect(curves[0].coords[1]).toBe(0)
      expect(curves[1].coords[1]).toBe(height)
      expect(curves[1].coords[3]).toBe(height)
      expect(shape.some(p => p.op === 'L' && p.coords[0] === innerX &&
        p.coords[1] === height - cornerHeight)).toBe(true)
      // The top and bottom roof tips project FURTHER inward than the
      // straight middle edge, giving the GREEN area large rounded corners.
      const reach = Math.abs(tip!.coords[0] - innerX)
      expect(reach).toBeGreaterThan(width * 0.045)
      expect(reach).toBeLessThan(width * 0.08)
      const isLeft = shape === left
      expect(isLeft ? tip!.coords[0] > innerX : tip!.coords[0] < innerX).toBe(true)
      // The CURVED VISIBLE roof edge at the first playable touchline
      // remains behind 2m of net space. Its rectangular paint bounds can
      // extend further, but clipping protects the actual pitch.
      expect(isLeft ? innerX < pitch.x : innerX > pitch.x + pitch.width).toBe(true)
      const t = Math.sqrt(pitch.y / cornerHeight)
      const visibleAtTouchline = innerX + (tip!.coords[0] - innerX) * (1 - t) ** 2
      const netSpace = 2 * pitch.scale
      expect(isLeft
        ? visibleAtTouchline < pitch.x - netSpace
        : visibleAtTouchline > pitch.x + pitch.width + netSpace).toBe(true)
    }
    const leftCurve = left.filter(p => p.op === 'Q')
    const rightCurve = right.filter(p => p.op === 'Q')
    for (let i = 0; i < 2; i++) {
      expect(leftCurve[i].coords[0] + rightCurve[i].coords[0]).toBeCloseTo(width)
      expect(leftCurve[i].coords[2] + rightCurve[i].coords[2]).toBeCloseTo(width)
      expect(leftCurve[i].coords[1]).toBe(rightCurve[i].coords[1])
      expect(leftCurve[i].coords[3]).toBe(rightCurve[i].coords[3])
    }
    // The white surface must be wide enough to FILL the newly extended
    // curved corners, rather than exposing a dark triangular void.
    const leftTip = left.find(p => p.op === 'L' && p.coords[1] === 0)!.coords[0]
    const rightTip = right.find(p => p.op === 'L' && p.coords[1] === 0)!.coords[0]
    expect(roofPanels[0].x + roofPanels[0].w).toBeCloseTo(leftTip)
    expect(roofPanels[4].x).toBeCloseTo(rightTip)
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
      quadraticCurveTo: () => {},
      closePath: () => {},
      clip: () => {},
      save: () => {},
      restore: () => {},
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
      // Raw paint rectangles now REACH the curved tips at the top/bottom;
      // the clipped silhouette (tested above) stays behind the net space
      // at the level of the playable field.
      expect(left.x + left.w).toBeGreaterThan(goalLineLeft)
      expect(right.x).toBeLessThan(goalLineRight)
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
