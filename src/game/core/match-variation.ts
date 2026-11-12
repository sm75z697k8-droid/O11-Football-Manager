/**
 * Fresh-browser match seeds and seeded AI exploration are separate concerns.
 * The UI obtains entropy through Web Crypto; the deterministic match engine
 * only ever sees the resulting unsigned 32-bit seed.
 */
export const MAX_MATCH_SEED = 0xffff_ffff

/** Guarantees that NEW is different from the immediately previous match.
 * Does not guarantee different match outcomes; physics still decides them.
 */
export function distinctMatchSeed(previous: number, sampled: number): number {
  if (!Number.isInteger(previous) || previous < 0 || previous > MAX_MATCH_SEED ||
      !Number.isInteger(sampled) || sampled < 0 || sampled > MAX_MATCH_SEED) {
    throw new RangeError('Match seeds must be unsigned 32-bit integers')
  }
  return sampled === previous ? (previous + 1) >>> 0 : sampled
}
