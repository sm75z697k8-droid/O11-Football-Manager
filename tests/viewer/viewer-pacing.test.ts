import { describe, expect, it } from 'vitest'
import {
  calculateFrameAdvance, formatDiagnosticTime, STEP_MS, MAX_TICKS_PER_FRAME,
} from '../../src/game/viewer/pacing'

describe('Phase 6 fixed-step viewer pacing', () => {
  it('advances simulation using exactly the original 50 ms logical step', () => {
    expect(STEP_MS).toBe(50)
    expect(calculateFrameAdvance(0, 20, 1)).toEqual({
      steps: 0, remainderMs: 20, limited: false,
    })
    expect(calculateFrameAdvance(20, 30, 1)).toEqual({
      steps: 1, remainderMs: 0, limited: false,
    })
    expect(calculateFrameAdvance(5, 60, 1)).toEqual({
      steps: 1, remainderMs: 15, limited: false,
    })
  })

  it('changes wall-clock speed, never the underlying simulation timestep', () => {
    expect(calculateFrameAdvance(0, 50, 1).steps).toBe(1)
    expect(calculateFrameAdvance(0, 50, 2).steps).toBe(2)
    expect(calculateFrameAdvance(0, 50, 4).steps).toBe(4)
  })

  it('bounds Safari background stalls and discards excessive catch-up debt', () => {
    const longFrame = calculateFrameAdvance(0, 60000, 4)
    expect(longFrame.steps).toBe(MAX_TICKS_PER_FRAME)
    expect(longFrame.limited).toBe(true)
    expect(longFrame.remainderMs).toBe(0)
    expect(calculateFrameAdvance(0, -500, 1).steps).toBe(0)
    expect(calculateFrameAdvance(0, NaN, 1).steps).toBe(0)
  })

  it('labels diagnostic time without claiming an official football match clock', () => {
    expect(formatDiagnosticTime(0)).toBe('00:00')
    expect(formatDiagnosticTime(20)).toBe('00:01')
    expect(formatDiagnosticTime(1200)).toBe('01:00')
    expect(formatDiagnosticTime(2400)).toBe('02:00')
  })
})
