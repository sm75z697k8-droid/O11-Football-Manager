/**
 * O11 deterministic random stream v1.
 *
 * xoshiro128** with exact unsigned 32-bit JavaScript operations.
 * Seed derivation: FNV-1a over UTF-16 code units, initialized with the
 * master seed XORed into the offset basis, followed by SplitMix32 expansion.
 *
 * Every match subsystem should use a stable, named stream derived from the
 * match seed. This is pseudorandom, NOT cryptographic randomness.
 *
 * Changing any detail here requires an algorithm/version change and updated
 * golden-vector replay fixtures. No Math.random() is used by this module.
 */
export const RNG_ALGORITHM = 'xoshiro128**/o11-v1' as const
export const RNG_SEED_DERIVATION = 'fnv1a32-utf16-splitmix32/o11-v1' as const
const UINT32_RANGE = 0x1_0000_0000
const MAX_UINT32 = 0xffff_ffff

type StateWords = [number, number, number, number]

export interface RandomStreamCheckpoint {
  readonly algorithm: typeof RNG_ALGORITHM
  readonly seedDerivation: typeof RNG_SEED_DERIVATION
  readonly masterSeed: number
  readonly streamId: string
  readonly words: readonly [number, number, number, number]
  /** Counts underlying uint32 draws, including rejection-sampling retries. */
  readonly drawCount: number
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isInteger(value) && value >= 0 && value <= MAX_UINT32
}

function assertMasterSeed(value: unknown): asserts value is number {
  if (!isUint32(value)) {
    throw new RangeError('Master seed must be an unsigned 32-bit integer')
  }
}

function assertStreamId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new RangeError('Stream ID must be a nonempty string of at most 128 UTF-16 code units')
  }
}

function rotl32(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function deriveStreamSeed(masterSeed: number, streamId: string): number {
  let hash = (0x811c9dc5 ^ masterSeed) >>> 0
  for (let i = 0; i < streamId.length; i += 1) {
    hash = Math.imul(hash ^ streamId.charCodeAt(i), 0x01000193) >>> 0
  }
  return hash
}

function seedState(masterSeed: number, streamId: string): StateWords {
  let x = deriveStreamSeed(masterSeed, streamId)
  const nextSplitMix32 = (): number => {
    x = (x + 0x9e3779b9) >>> 0
    let z = x
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  const words: StateWords = [
    nextSplitMix32(), nextSplitMix32(), nextSplitMix32(), nextSplitMix32(),
  ]
  // xoshiro must never start from an all-zero state.
  if (words.every((word) => word === 0)) words[0] = 0x9e3779b9
  return words
}

export class SeededRandomStream {
  readonly masterSeed: number
  readonly streamId: string
  private readonly words: StateWords
  private draws: number

  private constructor(
    masterSeed: number, streamId: string, words: StateWords, draws: number,
  ) {
    this.masterSeed = masterSeed
    this.streamId = streamId
    this.words = words
    this.draws = draws
  }

  static create(masterSeed: number, streamId: string): SeededRandomStream {
    assertMasterSeed(masterSeed)
    assertStreamId(streamId)
    return new SeededRandomStream(
      masterSeed, streamId, seedState(masterSeed, streamId), 0,
    )
  }

  static restore(value: unknown): SeededRandomStream {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Expected an RNG checkpoint object')
    }
    const record = value as Record<string, unknown>
    if (record.algorithm !== RNG_ALGORITHM || record.seedDerivation !== RNG_SEED_DERIVATION) {
      throw new RangeError('Unsupported RNG checkpoint version')
    }
    assertMasterSeed(record.masterSeed)
    assertStreamId(record.streamId)
    const words = record.words
    if (!Array.isArray(words) || words.length !== 4 ||
      !words.every((word: unknown) => isUint32(word)) ||
      words.every((word: number) => word === 0)) {
      throw new RangeError('Invalid xoshiro128** internal state')
    }
    if (!Number.isSafeInteger(record.drawCount) || (record.drawCount as number) < 0) {
      throw new RangeError('Invalid RNG draw count')
    }
    // Copy state: external mutation of a checkpoint cannot change the stream.
    return new SeededRandomStream(
      record.masterSeed, record.streamId, [...words] as StateWords, record.drawCount as number,
    )
  }

  nextUint32(): number {
    if (this.draws === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('RNG draw count overflow')
    }
    const s = this.words
    const result = Math.imul(rotl32(Math.imul(s[1], 5), 7), 9) >>> 0
    const t = (s[1] << 9) >>> 0
    s[2] = (s[2] ^ s[0]) >>> 0
    s[3] = (s[3] ^ s[1]) >>> 0
    s[1] = (s[1] ^ s[2]) >>> 0
    s[0] = (s[0] ^ s[3]) >>> 0
    s[2] = (s[2] ^ t) >>> 0
    s[3] = rotl32(s[3], 11)
    this.draws += 1
    return result
  }

  /** Uniform float in [0, 1); one uint32 draw. */
  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE
  }

  /**
   * Unbiased integer [0, maxExclusive); rejection sampling avoids modulo bias.
   * The number of low-level draws may vary, and is part of checkpoint state.
   */
  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError('maxExclusive must be an integer between 1 and 2^32')
    }
    const threshold = UINT32_RANGE - (UINT32_RANGE % maxExclusive)
    let value: number
    do {
      value = this.nextUint32()
    } while (value >= threshold)
    return value % maxExclusive
  }

  /** Fully serializable, detached snapshot. */
  checkpoint(): RandomStreamCheckpoint {
    return {
      algorithm: RNG_ALGORITHM,
      seedDerivation: RNG_SEED_DERIVATION,
      masterSeed: this.masterSeed,
      streamId: this.streamId,
      words: [...this.words] as StateWords,
      drawCount: this.draws,
    }
  }
}

export function createRandomStream(masterSeed: number, streamId: string): SeededRandomStream {
  return SeededRandomStream.create(masterSeed, streamId)
}

export function restoreRandomStream(checkpoint: unknown): SeededRandomStream {
  return SeededRandomStream.restore(checkpoint)
}
