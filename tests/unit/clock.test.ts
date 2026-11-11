import { describe, expect, it } from 'vitest'
import {
  CLOCK_SCHEMA_VERSION, FIXED_STEP_MILLISECONDS, MAX_SIMULATION_TICK,
  advanceSimulationClock, createSimulationClock,
  elapsedSimulationMilliseconds, restoreSimulationClock,
} from '../../src/game/core/clock'

describe('fixed simulation clock', () => {
  it('uses integer, serialized 50ms logical steps', () => {
    expect(FIXED_STEP_MILLISECONDS).toBe(50)
    const initial = createSimulationClock()
    expect(initial).toEqual({ schemaVersion: CLOCK_SCHEMA_VERSION, tick: 0 })
    const advanced = advanceSimulationClock(initial, 100)
    expect(advanced.tick).toBe(100)
    expect(elapsedSimulationMilliseconds(advanced)).toBe(5000)
    expect(initial.tick).toBe(0)
  })

  it('can represent exactly 90 simulated minutes without a display timer', () => {
    const afterMatch = advanceSimulationClock(createSimulationClock(), 108_000)
    expect(elapsedSimulationMilliseconds(afterMatch)).toBe(90 * 60 * 1000)
  })

  it('does not advance when no steps are requested', () => {
    const clock = createSimulationClock(50)
    expect(advanceSimulationClock(clock, 0)).toBe(clock)
    expect(clock.tick).toBe(50)
    expect(Object.isFrozen(clock)).toBe(true)
  })

  it('restores exactly from a JSON checkpoint', () => {
    const original = createSimulationClock(12_345)
    const restored = restoreSimulationClock(JSON.parse(JSON.stringify(original)))
    expect(advanceSimulationClock(restored, 55)).toEqual(advanceSimulationClock(original, 55))
  })

  it('rejects invalid ticks and step counts', () => {
    for (const tick of [-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, MAX_SIMULATION_TICK + 1]) {
      expect(() => createSimulationClock(tick)).toThrow()
    }
    const clock = createSimulationClock(2)
    for (const steps of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => advanceSimulationClock(clock, steps)).toThrow()
    }
  })

  it('prevents precision overflow and rejects incompatible checkpoints', () => {
    const end = createSimulationClock(MAX_SIMULATION_TICK)
    expect(() => advanceSimulationClock(end)).toThrow()
    expect(() => restoreSimulationClock({ schemaVersion: 2, tick: 0 })).toThrow()
    expect(() => restoreSimulationClock({ schemaVersion: 1, tick: -1 })).toThrow()
    expect(() => restoreSimulationClock(null)).toThrow()
  })
})
