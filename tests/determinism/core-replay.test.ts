import { describe, expect, it } from 'vitest'
import {
  advanceSimulationClock, createSimulationClock, restoreSimulationClock,
} from '../../src/game/core/clock'
import type { SimulationClock } from '../../src/game/core/clock'
import { createRandomStream, restoreRandomStream } from '../../src/game/core/rng'
import type { RandomStreamCheckpoint, SeededRandomStream } from '../../src/game/core/rng'

/**
 * Pure deterministic-core test harness, NOT a football game or match replay.
 * This measures scheduler-independent clock advancement, separately derived
 * random streams, and lossless checkpoint continuation over many logical ticks.
 */
interface CoreCheckpoint {
  clock: SimulationClock
  decisions: RandomStreamCheckpoint
  contacts: RandomStreamCheckpoint
  trace: readonly number[]
}

function runCoreTicks(seed: number, stopTick: number, from?: CoreCheckpoint): CoreCheckpoint {
  let clock = from ? restoreSimulationClock(from.clock) : createSimulationClock()
  const decisions: SeededRandomStream = from
    ? restoreRandomStream(from.decisions)
    : createRandomStream(seed, 'team/home/decisions')
  const contacts: SeededRandomStream = from
    ? restoreRandomStream(from.contacts)
    : createRandomStream(seed, 'ball/contact')
  const trace = from ? [...from.trace] : []

  while (clock.tick < stopTick) {
    clock = advanceSimulationClock(clock)
    if (clock.tick % 7 === 0) trace.push(decisions.nextInt(15))
    if (clock.tick % 13 === 0) trace.push(contacts.nextInt(0x10000))
  }

  return {
    clock,
    decisions: decisions.checkpoint(),
    contacts: contacts.checkpoint(),
    trace,
  }
}

describe('Phase 0C core reproducibility (no match gameplay)', () => {
  it('repeats the same tick and random trace with identical inputs', () => {
    const a = runCoreTicks(123456789, 12_000)
    const b = runCoreTicks(123456789, 12_000)
    expect(a).toEqual(b)
    expect(a.clock.tick).toBe(12_000)
    expect(a.trace.length).toBeGreaterThan(2000)
  })

  it('checkpoint + resume is identical to uninterrupted logical execution', () => {
    const uninterrupted = runCoreTicks(713, 12_000)
    const midpoint = runCoreTicks(713, 4213)
    const serialized = JSON.parse(JSON.stringify(midpoint)) as CoreCheckpoint
    expect(runCoreTicks(713, 12_000, serialized)).toEqual(uninterrupted)
  })

  it('different seeds produce reproducible, divergent traces', () => {
    const first = runCoreTicks(100, 300)
    const second = runCoreTicks(101, 300)
    expect(first).toEqual(runCoreTicks(100, 300))
    expect(first.trace).not.toEqual(second.trace)
  })

  it('runs 108,000 simulation ticks without relying on wall time or rendering', () => {
    const result = runCoreTicks(0, 108_000)
    expect(result.clock.tick).toBe(108_000)
    expect(result.decisions.drawCount).toBeGreaterThan(10000)
    expect(result.contacts.drawCount).toBeGreaterThan(8000)
  })
})
