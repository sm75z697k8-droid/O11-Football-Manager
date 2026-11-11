# O11 — Phase 0B: canonical football data model

This phase defines **data only**. No ball physics, movement, tactics execution, match clock, seeded RNG, score generation, career systems or worker is implemented.

- 49 core ratings: 14 technical, 14 mental, 8 physical, 13 goalkeeper-specific.
- 11 hidden characteristics and 10 profile categories (names only, no fabricated aggregate ability scores).
- Positional familiarity and preferred-foot / weaker-foot proficiency separate from attributes.
- Stable player and club IDs; no duplicate rosters inside clubs.
- Configurable metric pitch, 105 m × 68 m by default.
- Two fictional 11-player clubs with validated 4-3-3 starting assignments.
- Pure runtime validation for untrusted JSON-shaped input.
- Initial data schema version 1; runtime match state will be introduced in Phase 0D.

The current web page remains a **temporary developer preview**. The intended finished O11 game is **full-screen landscape-first** on iPhone and desktop. The real match viewer will derive its positions from the engine, not from decorative UI animations. Do not claim that current schematic circles are live football agents.

All initial fixture records are fictional. No original FM database, badges, player likenesses or licensed assets are included.

## Phase 0B acceptance

Run `npm run check` (GitHub Actions automatically runs typecheck, Vitest, and the Vite production build). Confirm 22 unique players, 11 slots/team, valid profiles and complete attribute groups. Confirm invalid data is rejected with useful field paths. No current UI is required to visualize a match.

## Next implementation boundary

Phase 0C: simulation tick clock, deterministic RNG and reproducibility tests. Do not implement until separately approved.
