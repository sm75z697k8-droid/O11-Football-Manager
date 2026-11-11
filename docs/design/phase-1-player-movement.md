# O11 — Phase 1: deterministic individual player locomotion

**Status:** Implemented as a headless movement engine for Harbor Athletic vs Vale Rovers, **not** as a playable football match.

## Implemented

- Real 105 × 68 metre coordinates from the validated two-team fixture; custom valid pitch sizes remain supported.
- Pure TypeScript player locomotion at the fixed 50 ms logical tick from Phase 0C.
- Bounded 2D velocity, acceleration and braking, orientation with limited angular turning, soft approach and stopping near assigned destinations, and pitch boundary handling.
- Motion parameters are derived from the existing 0–100 physical attributes: `sprintSpeed`, `acceleration`, `agility`, `balance`, plus an energy factor (energy currently remains constant).
- New `setMovementTarget` diagnostic command: accepted only for a real player belonging to the declared team, only for a finite in-bounds target; assigned on the NEXT tick in deterministic sequence order. The previous `setPressingIntensity` instruction continues to work but does not make any players press.
- One shared private authoritative state for movement and future visualization; externally returned objects are detached copies.
- Versioned JSON checkpoint/restore of position, velocity, orientation, target, command state and RNG streams; no `Math.random()` or wall clock used by locomotion.
- Tests for attribute impact, bounds, acceleration/turn limits, motion progression, stationary players, arbitrary tick chunk sizes, identical replay and mid-stride resume.
- Independent multi-player Node workload baseline across 22 players, 300 ticks; reports milliseconds and checkpoint bytes but does not assert arbitrary timing budgets.

## Model choices and limitations

Simulation calibrations are **estimates**, not individually measured sprint or biomechanics data. This stage develops a stable physical motion mechanism, not a validated elite-football motion model. Calibrations should later be tuned using credible observations and match telemetry.

Players only move when a **diagnostic external target** is submitted, since tactical AI and player decision-making are not implemented. This is intentionally different from fake predefined football events or cosmetic animations.

Not yet implemented: player-player collisions, body size, dribbling, momentum interactions with the ball, tactical perception, pressing behaviors, offside, fouls, stamina depletion, game periods, scores, actual match duration, Web Worker integration or a live 2D viewer. Ball remains static and the period remains `notStarted`. The existing webpage remains a temporary preview, not the final full-screen, landscape-first game.

The model does not independently prevent two agents overlapping. Proper player-player spatial exclusion and possession interactions require careful subsequent physics work, not visual workarounds.

## Checkpoint compatibility

The match state and checkpoint schema have been deliberately **version-bumped to v2**. Older v1 Phase 0D checkpoint snapshots are rejected rather than silently misinterpreted. This doesn't delete existing files or career saves (there are no implemented career saves yet). A migration must be designed when persistent saves are added.

## Test it

GitHub Actions: `npm run check` (typecheck, all Vitest tests and compiled asset smoke test); Pages deployment also verifies published JS and CSS over HTTP.

For local / Actions profiling, `npm run benchmark:motion` measures the diagnostic workload under Node. This does NOT tell us performance on iPhone Safari; device profiling and frame delivery start once the real match viewer is introduced.

## Next

Do not introduce fake 2D match animation. Subsequent milestones must establish ball mechanics, movement intent from tactical agents, collision handling, and a Canvas viewer that uses the same authoritative player positions.

Do not start further implementation without explicit approval.
