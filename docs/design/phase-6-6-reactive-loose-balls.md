# Phase 6.6 — Reactive loose-ball recovery and link play

## User-observed failure

In the iPhone viewer, players could run away from a misplaced pass or loose ball and appear clueless about nearby teammates. O11's previous possession-phase classifier treated the **team of the last player to touch the ball** as the attacking side whenever the ball had no controller. But a missed or intercepted pass is not possession: a nearer opponent can physically reach it first. The team AI also retained its previous off-ball assignment for up to 12 physics ticks (0.6 simulated seconds) after a real kick or interception.

## Implementation

### A genuinely contested free ball

The pure module `src/game/ai/loose-ball.ts` estimates the *earliest reachable intercept* for one eligible footballer on each team, using the existing physical player acceleration, running limits and moving-ball estimates. Both teams nominate a recovery contender; the next likely recipient is chosen by relative arrival time rather than last touch, with a small last-touch tie preference to prevent artificial jitter. Neither side is automatically awarded ball possession.

The physical passer's intended receiver still follows the actual `passIntent` while an attributable pass is in flight, provided the original kick remains valid; other teammates retain dynamic supporting or recovery positions. The defending team uses the identified ball winner as a preferred presser if inside its local permitted pressing radius, avoiding the nearest midfielder running away to mark an irrelevant opposition defender.

### React promptly to physical changes

The autonomous decision runner detects newly recorded successful/failed kicks, interceptions, deflections or challenges and refreshes the entire team assignment at the **next 50ms tick** rather than waiting for the ordinary 12-tick cadence. Between those tactical decisions, only existing engaged loose-ball chasers adjust their targets to the actual moving ball once per tick. This is a bounded correction, not a homing directive for all 22 players.

### Improve short passing sequences

The minimum interval between AI pass *attempts* is lowered from 24 to **12 ticks** (0.6 simulated seconds). Good open moving outlets receive a limited preference in the existing deterministic utility comparison; opponents blocking a corridor remain heavily penalized. All pass requests continue to be scheduled as physical `attemptKick` commands, and the ball can still be misplaced or intercepted.

## Important limitations

- This is **not** a Football Manager equivalent. It does not reproduce Sports Interactive's proprietary match engine, human perception, advanced role-switching, coached pressing traps, anticipation models or offside.
- The model is deterministic and rule/utility-based, with game-design estimate parameters; no externally verified professional tracking calibration exists.
- Aerial movement is estimated without complete collision/spin flight modelling. Free-ball follow targets do not guarantee physical interceptions, first touches or completed passing.
- The existing command history cap of 256 can limit long continuous AI play; full career/90-minute simulation needs event compaction. No official matches, shooting/goals, match clock, referee or restarts. Balls leaving play still pause the viewer.
- No new schema fields; `MATCH_STATE_SCHEMA_VERSION` remains **8**. The engine-version string is bumped to `o11-contested-ball-recovery-p66-v1` so an earlier AI replay cannot be silently misinterpreted.
- The Canvas rendering, opening kickoff, passes, pressing, physical locomotion, save state and existing fixture remain integrated and separate. GitHub CI can verify logic/replay/build but **not actual iPhone game feel or FPS**.

## Validation

New tests model a last-touching team whose missed pass falls closer to the opponent, verify two active challengers without all 22 players converging, check next-tick reaction to new physical contacts, test every-tick pursuit retargeting and no fake possession, and check deterministic headless replay. Existing open-pass, 4-3-3 flank discipline, defending #8 recovery, kickoff, contact physics and viewer integration tests remain required. User visual observation is the final assessment of football behavior.
