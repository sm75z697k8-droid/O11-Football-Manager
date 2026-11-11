# O11 — Phase 0C: deterministic simulation core

## Scope (implemented)

- `src/game/core/clock.ts`: pure, immutable logical tick clock, 50 ms per tick (provisional), explicit advancement, bounded integer tick range, JSON checkpoint restoration.
- `src/game/core/rng.ts`: xoshiro128**/o11-v1 with a documented FNV-1a UTF-16 / SplitMix32 seed expansion, named independent pseudorandom streams, 32-bit integer and float draws, unbiased integer sampling, complete JSON checkpoint/restore.
- `tests/unit/clock.test.ts`, `tests/unit/rng.test.ts`: fixed vectors, validation, overflow and serialization regression tests.
- `tests/determinism/core-replay.test.ts`: deterministic-core test harness validating repeated executions and checkpoint continuation.

`108,000` ticks are 90 simulated minutes at the **provisional** 50 ms timestep, excluding stoppage time. We are not claiming these modules create a football match. Movement, ball physics, player perception and match periods are not implemented.

## Determinism contract

The same master seed, stable stream identifier, algorithm version and ordered draw sequence yield the same pseudorandom numbers. The same simulation clock and explicit advance calls yield the same logical time. No JavaScript real-time clock or `Math.random()` drives these authoritative core modules.

**Future match replays** will additionally require complete starting MatchState, ordered commands, individual intentions, internal physics state and every random stream checkpoint. Phase 0D will supply authoritative match-state and command infrastructure. Engine/rules versioning will be required for compatibility.

## Assumptions and limitations

1. Stream derivation hashes UTF-16 code units with FNV-1a. Distinct identifiers produce different deterministic streams in test fixtures, but 32-bit hash collisions are mathematically possible. Stream IDs should be stable, named and unique.
2. The RNG is not for security or cryptographic secrets.
3. Floating-point physics has not been implemented or cross-browser validated; strict cross-browser state equality is not yet promised.
4. No Web Worker, headless football match execution, final-score generation, tactical AI, substitutions or saving of live games exists in Phase 0C.
5. The web UI is a temporary foundation preview. The eventual finished game is full-screen, **landscape-first**, not a conventional landing page. Avoid fake 2D match animation.

## Validation

GitHub Actions must pass `npm run typecheck`, `npm run test`, and `npm run build` using `npm ci`. Golden random vectors are locked to algorithm version v1 and should not silently change.

## Next approval boundary

Phase 0D will implement match initialization, authoritative state, deterministic command scheduling and complete checkpoints. Do not implement it without separate approval.
