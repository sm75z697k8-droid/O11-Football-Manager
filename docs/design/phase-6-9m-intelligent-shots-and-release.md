# Phase 6.9M — Intelligent shots, aiming and physical quick-release

## User observation

An attacker appears to have a shooting/scoring opportunity but the team subsequently plays backward, rather than taking a credible shot. Two separate stages matter:

1. The *intention* planner compares shot, carry and actual receivable pass alternatives with estimated tactical utilities. Some apparently unhelpful backward passes may still be rated as safer than shooting.
2. The *physical release* gate historically imposed a single **18-tick / 0.9-second** AI kick interval on both passes and shots. After a successful team pass, an attacker could recognize a clear shot but not issue any real shot command for the next 18 ticks. Delaying that action gives nearby defenders time to close the window.

Identifying the release blocker required direct historical comparison. In 40 mirrored, constructed, unmarked shooting opportunities (8–24m from goal) **both 6.9L and 6.9M chose “shoot” for all 40** when fully eligible. Therefore merely increasing shot preference is **not proven** to address the player's observation. However, when the same fixtures represent an attacker controlling the ball **6 ticks after a previous team pass**, the old 6.9L release gate permitted **0/40** executable shot requests; 6.9M permits **40/40**. Those are **constructed decisions**, not live goals or observed browser frames, and the result does not imply every real shot should be taken or successfully converted.

## Changes

### A. Physically grounded goalmouth aiming

`src/game/ai/shot-window.ts` runs up to 80 ticks of the existing 50ms ball physics **once** per evaluation, using the exact actual-kick speed, lift and strength/Technique/Finishing/Long Shots/Composure accuracy blend. Ball drag and ground interaction are radially symmetric, so the radial trajectory can be reused to project the same time/height evolution onto **three actual shooting directions** (centre, left, right), with **five deterministic samples of the existing angle-error envelope** per direction.

The preview checks ball position at the full-ball goal-line plane and whether the trajectory falls inside the legal posts/crossbar envelope. It estimates a rough keeper-accessible goalmouth area from real keeper position, Reflexes and flight time. This is only a **tactical on-frame and approximate GK-clearance preview**: it consumes no match RNG, does not simulate defenders' full 2D collision paths, does not award or log shots/goals, and does not claim xG, a real probability of scoring, or calibrated save likelihood. `evaluateShootingOpportunity` still penalizes actual geometric defensive obstruction, difficult angle, weak finishing and long distance. It chooses the target whose estimated utility balances accuracy, obstruction and goalkeeper coverage; **aiming at the centre can be preferable** when the far corner would be inaccurate.

The actual `resolveContactAttempts` direction error, power, flight, goalkeeper response and real whole-ball goal adjudication are **unchanged**.

### B. Clear-shot opportunity cost

`src/game/ai/short-horizon.ts` makes a backward pass carry an opportunity cost **only** when the ball carrier has a relatively unpressured, credible immediate shot with a physically plausible on-frame fraction and unobstructed lane **and** the pass does not create an improved near-term attacking position. A heavily pressured attacker, genuinely blocked shot, or much better-positioned receiving teammate can still justify a backward pass. Seeded close-score discretion continues to work.

To avoid extra work on iPhone, the existing evaluation passes the **one precomputed shot opportunity** into the follow-up pass comparison rather than running a second physical shot preview for the same decision.

### C. Shot-ready release separate from pass spam

`canReleaseControlledBall(state, setup, 'standard' | 'shot')` retains the existing 18-tick pass-circulation spacing. A legitimate physically held **foot-level** ball can be shot 4 ticks (~0.2s) after the previous team kick. Both release pathways still require the true ball controller, no keeper hand-held state, and the existing actual first-touch/physical-settle checks (typically at least 3 ticks after the new reception, or an attribute-aware pressure-sensitive one-touch exception). `choosePossessionRelease` checks the selected **action type** so faster shot readiness never authorizes rapid repeat passes. Failed/miscontrolled touches still cannot launch a shot because ball ownership is physical.

This fixes a specific action-readiness defect without faking kick events or shooting outcomes.

## Verification and limits

The Phase 6.9M CI passed **338/338 tests over 55 files**, strict TypeScript and production build, including 10 new stage-level shot-intent unit tests, 1 full matrix diagnostic, and all earlier physics, goalkeeper distribution and replay tests.

- Direct constructed 40-scene historical comparison on pinned 6.9L source: 40 shoot *intentions* in both versions; **0 versus 40 physically permitted release decisions** at 6 ticks since the prior pass. A separate diagnostic PR was closed without merging.
- Nine standard short fictional seeded exhibitions: **14 genuine kicked shots, 3 goalkeeper catches and 1 actual goal** in 6.9M, versus **15 shots, 4 catches and 1 actual goal** in 6.9L. This sample does **not** establish more shots, superior conversion, or better match outcomes.
- Physically intended pass reception: **126 of 161** in 6.9M versus **129 of 164** in 6.9L. No broad passing improvement should be claimed from this small sample.
- Tests verify home/away mirrored shot release, genuine foot-level controlled shot commands with seeded accuracy, GK-side shot-window selection, low/high finisher dispersion, clear chance vs blocked chance, backwards-pass opportunity penalty, and blocking premature post-pass/post-touch release.
- Engine algorithm string bumps to `o11-physical-shot-window-p69m-v1`; checkpoint schema v9 unchanged. Historical deterministic checkpoint versions are never silently conflated.
- Current preview uses uncalibrated estimated weights; no professional event/outcome data, statistical xG fit or exact opponent interception solver. The exhibition still stops after a goal or out-of-play, without official restarts. No iPhone Safari runtime or animation has been verified in this PR.

## iPhone acceptance test

After deploying and refreshing, confirm **BUILD 6.9M**. Observe players receiving a pass within ~8–24m of goal while unmarked: they should now be able to release a physically chosen shot promptly, instead of losing the opportunity to the inherited 0.9s team kick cooldown. A blocked shot or crowded receiver should still lead to reasonable passing/carrying. Use **Copy match debug report** with seed/time if a specific backpass, delayed shot or other stall remains.
