import { describe, expect, it } from 'vitest'
import {
  RNG_ALGORITHM, RNG_SEED_DERIVATION, createRandomStream, restoreRandomStream,
} from '../../src/game/core/rng'

describe('versioned seeded xoshiro128** streams', () => {
  it('reproduces a frozen golden vector for seed 0 and a named stream', () => {
    const stream = createRandomStream(0, 'match/decisions')
    expect(stream.checkpoint().words).toEqual([
      3319938730, 3173060287, 1716253441, 3018454588,
    ])
    expect(Array.from({ length: 8 }, () => stream.nextUint32())).toEqual([
      1741409432, 86328492, 4278988562, 3114752465,
      3407796128, 4104902758, 330832224, 3651580539,
    ])
    expect(stream.checkpoint().words).toEqual([
      768702171, 1486673519, 3760137721, 1875330468,
    ])
    expect(stream.checkpoint().drawCount).toBe(8)
  })

  it('reproduces a second independent golden vector', () => {
    const stream = createRandomStream(123456789, 'team/home/decisions')
    expect(Array.from({ length: 6 }, () => stream.nextUint32())).toEqual([
      832369591, 553812867, 4056014388,
      530341952, 3123581630, 3740247852,
    ])
  })

  it('keeps two streams independent of interleaved draws', () => {
    const a1 = createRandomStream(42, 'player/a/decisions')
    const b1 = createRandomStream(42, 'player/b/decisions')
    const a2 = createRandomStream(42, 'player/a/decisions')
    const b2 = createRandomStream(42, 'player/b/decisions')
    const expectedA = Array.from({ length: 60 }, () => a1.nextUint32())
    const expectedB = Array.from({ length: 60 }, () => b1.nextUint32())
    const actualA: number[] = []
    const actualB: number[] = []
    for (let i = 0; i < 60; i += 1) {
      actualB.push(b2.nextUint32())
      actualA.push(a2.nextUint32())
    }
    expect(actualA).toEqual(expectedA)
    expect(actualB).toEqual(expectedB)
    expect(actualA).not.toEqual(actualB)
  })

  it('restores all random state from JSON without recomputing previous draws', () => {
    const original = createRandomStream(123, 'ball/contact')
    for (let i = 0; i < 80; i += 1) original.nextInt(13)
    const snapshot = JSON.parse(JSON.stringify(original.checkpoint()))
    const resumed = restoreRandomStream(snapshot)
    expect(Array.from({ length: 120 }, () => original.nextUint32()))
      .toEqual(Array.from({ length: 120 }, () => resumed.nextUint32()))
    expect(resumed.checkpoint()).toEqual(original.checkpoint())
  })

  it('does not allow editing a checkpoint to mutate an existing stream', () => {
    const original = createRandomStream(8, 'sample')
    const twin = createRandomStream(8, 'sample')
    const cp = original.checkpoint()
    ;(cp.words as number[])[0] = 7
    expect(original.nextUint32()).toBe(twin.nextUint32())
  })

  it('has a stable algorithm ID and rejection-sampling behavior', () => {
    const r = createRandomStream(1, 'bounded')
    const cp = r.checkpoint()
    expect(cp.algorithm).toBe(RNG_ALGORITHM)
    expect(cp.seedDerivation).toBe(RNG_SEED_DERIVATION)
    for (let i = 0; i < 200; i += 1) {
      const num = r.nextInt(7)
      expect(num).toBeGreaterThanOrEqual(0)
      expect(num).toBeLessThan(7)
    }
    expect(r.nextInt(1)).toBe(0)
    expect(r.nextInt(0x1_0000_0000)).toBeGreaterThanOrEqual(0)
    expect(r.checkpoint().drawCount).toBeGreaterThanOrEqual(202)
  })

  it('returns [0, 1) floats and rejects invalid bounds', () => {
    const r = createRandomStream(9, 'floats')
    for (let i = 0; i < 300; i += 1) {
      expect(r.nextFloat()).toBeGreaterThanOrEqual(0)
      expect(r.nextFloat()).toBeLessThan(1)
    }
    for (const bound of [0, -1, 1.2, NaN, Infinity, 0x1_0000_0000 + 1]) {
      expect(() => r.nextInt(bound)).toThrow()
    }
  })

  it('rejects invalid seeds, stream IDs, versions and impossible internal states', () => {
    expect(() => createRandomStream(-1, 'x')).toThrow()
    expect(() => createRandomStream(0x1_0000_0000, 'x')).toThrow()
    expect(() => createRandomStream(1.5, 'x')).toThrow()
    expect(() => createRandomStream(1, '  ')).toThrow()
    const good = createRandomStream(1, 'sample').checkpoint()
    expect(() => restoreRandomStream({ ...good, algorithm: 'unknown' })).toThrow()
    expect(() => restoreRandomStream({ ...good, words: [0, 0, 0, 0] })).toThrow()
    expect(() => restoreRandomStream({ ...good, words: [1, 2, 3] })).toThrow()
    expect(() => restoreRandomStream({ ...good, drawCount: -1 })).toThrow()
    expect(() => restoreRandomStream(null)).toThrow()
  })
})
