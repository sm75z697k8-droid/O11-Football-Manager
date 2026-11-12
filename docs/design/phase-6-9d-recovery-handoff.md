# Phase 6.9D — Intelligent loose-ball recovery and team handoff

## Problem
An explicit pass intent forced the original target player to chase the ball until somebody touched it or the intent expired, even if the pass drifted far away and another teammate could intercept first. The team then waited for the normal tactical refresh before reallocating recovery and support.

## Design
- Keep the intended receiver's priority immediately following a **genuine kick**, not merely a queued command.
- On a fixed four-tick (200ms) cadence, compare that player with eligible outfield teammates using the same acceleration/speed-dependent `estimatedRecoverySeconds` predictor used by the loose-ball system. Do not include the passer or a protected kickoff taker as a replacement.
- **Never** abandon a nominated receiver while their own projected interception is still physically plausible. Only when that forecast fails, relinquish the intent if another teammate has a recovery advantage of at least 0.55s. One-way handoff avoids oscillation.
- A released intent forces a new coordinated 22-player tactical snapshot **that same tick**. Only the nominated recovery player engages, while the previous intended receiver returns to its normal shape/support instructions. Team support geometry uses the same nominated player as the recovery race.
- The separate protected opening kickoff remains unchanged to preserve its legal and reproducible first reception.
- Ball movement, kick quality, first-touch control, physical tackles and out-of-play decisions remain entirely in the existing authoritative physics.

## Bounded performance and determinism
No additional saved state is introduced (schema v9). This review is pure and examines at most ten alternate candidates every fourth tick while a loose AI pass intent exists; it stops once it finds a substantially faster outfield candidate. Algorithm version is incremented to prevent replay compatibility errors. Predicted recovery times and thresholds are design estimates rather than real-world calibrated values.

## Validation
Automated tests cover physically lost passes, original receiver retention, pending non-kicked commands, review cadence, immutability and deterministic checkpoints. Existing GitHub CI must verify typecheck, full tests and build. In-game visual quality, restart realism and iPhone Safari FPS must be confirmed manually; this is not a full tactical or football-rules engine.
