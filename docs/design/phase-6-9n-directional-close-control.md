# Phase 6.9N — Direction-aware close control in genuinely open space

## Reported issue

Players sometimes look as though they lose the ball while dribbling without nearby defenders. Inspection of the authoritative 6.9M physics found that a controlled ball was permanently attached at the **original** receiving offset. A striker receiving the ball behind or on the wrong side could run or turn for several seconds without ever moving their ball contact point toward their forward feet. The renderer was displaying that real, awkward ball position; it was not creating a separate decorative ball.

A ball with non-null `controllerId` does not physically detach without a kick, a challenge/first-touch outcome or another authoritative state transition. We should not introduce a random loss merely to create dribbling variety.

## Narrow change

The owned-ball 50ms engine step now uses `closeControlOffset` from `src/game/physics/contact.ts` **only while all of the following are true**:

- A genuine physical outfield ball owner exists and has an autonomous *carry* decision.
- The carrier is moving toward a nontrivial target and has nontrivial speed.
- No opposition player is within **7 metres**, matching the user's specifically observed unopposed behaviour and protecting the existing realistic contested ball physics.
- The stored contact position is visibly poorly aligned: too far behind the carrier's actual facing or excessively sideways.

When those conditions are met, a bounded 50ms correction moves the stored football contact point toward a direction between the player's **actual body heading and momentum**. The desired touch radius is a designed estimate: roughly .41–.75m depending on speed and a blend of real Dribbling, First Touch, Agility, Balance and Composure attributes. High-skill carriers adjust more responsively. The correction is step-limited to prevent instant side-to-side teleportation and capped at .75m. The ball is kept within the pitch while physically under control, even if the player is near a boundary. These are **unmeasured simulation calibrations**, not real-football tracking numbers.

All changes update the authoritative `BallMatchState.position` AND `controlOffset`. Consequently renderer, checkpoint/replay, tackling contact and kicks still see the identical physical state. No separate animation-only ball. The existing foot-reach invariant <=1.05m, player velocity equality, original physical touch provenance, unchanged `controllerId`, and goalkeeper hands-held offset remain intact. Ordinary settled passing/shooting, physical tackles, kicks, free ball trajectory, goalkeeper catching and goal-line checks remain the existing engines.

**This is intentionally NOT a complete dribble system.** There is no discrete free-ball knock-on, nonlinear foot-to-ball momentum, independent ball trajectory between steps, opponent-aware skill move, random miscontrol without cause, or rated actual dribbling success probability. In the current first increment the ball remains controlled continuously in open space. Existing physical defenders can still win a tackle. The authoritative engine only applies the correction for AI-labeled carries; manual movement outside this tactical context is unchanged.

## Regression discovery and response

An initial attempt to update **every** controlled-ball offset on **every** tick was rejected after GitHub CI: several historical seed-specific goalkeeper expectations failed and nine-seed shooting declined to 7 from 14. A tighter-offset but unconditional approach remained too disruptive. A second iteration updating every real carry remained overly aggressive.

The final gated strategy only fixes demonstrably bad alignment **during unopposed carries**, leaving current ordinary possession/pass preparation and contested challenges alone.

Some prior tests assumed that seed 42 would always produce a particular goalkeeper catch, even after changing authoritative physical ball positions. Those tests have been made less brittle using a shared helper that searches a small bounded list of seeds for a **real swept keeper catch**. They continue to assert actual hands possession, deterministic checkpoint restoration, the next-tick full 22-agent shape, and actual real throw commands. The live throw-reception benchmark remains observational rather than guaranteeing >1 throws in its nine-seed sample; separate real catch/throw unit tests still verify both ends.

## Verification and non-claims

GitHub Actions strict TypeScript, **345 / 345 tests across 57 files**, production Vite build: all green on the final code before documentation.

**Real seeded live five-seed simulation diagnostic:**
- **3,122 actual ball-controlled ticks** examined
- **179 genuine noncosmetic foot-offset corrections**, no opponent within 7m at the correction
- **0 changes from controlled possession to unowned ball without a real release or challenge contact**
- Each sampled ball point remained exactly equal to the owner's physical location plus the stored contact offset and inside foot reach

Six focused direct physical unit tests also verify mirrored home and away carries, smooth directional turning, high/low skill responsiveness, bounded corrections, touchline close control, unchanged hands-held GK catches and exact deterministic checkpoint replay.

**Important nine-seed sample comparison (not statistics from professional football):**

| Metric (up to 1,600 ticks per seed) | 6.9M | 6.9N |
| --- | ---: | ---: |
| Genuine player shot contacts | 14 | 5 |
| Real goals | 1 | 1 |
| Real goalkeeper catches | 3 | 1 |
| Intended pass controls | 126 / 161 | 148 / 171 |
| GK physical throw→intended control | 4 / 4 | 1 / 1 |

These are **different deterministic match trajectories** after changing physical control positions, not equal-event controlled experiments, and too small to establish long-run shooting, goal, dribble, pass or keeper success rates. The decline in shots is a monitoring concern, not a validated improvement. Do **not** claim overall match intelligence or dribble failure rate has been solved. Verify visually and with a larger set of matches before further tuning.

Engine algorithm string moves to `o11-directional-close-control-p69n-v1`. Schema v9 is unchanged, but old algorithm checkpoints must not silently resume as current physics.

## iPhone test

After Pages deployment and Safari refresh, confirm **BUILD 6.9N**. Watch a genuine uncontested carry, especially a change of direction. The ball should transition smoothly from an inherited wrong-side contact point toward the player's forward foot rather than remain stuck behind. In a contested run the older physical tackle rules still apply. Watch how often attacking teams can reach good chances; the sampled reduction in shots warrants your feedback. Use **Copy Match Debug Report**, including seed, build, and tick/minute, for any ball that appears to detach without a physical event. Do not conclude that a full dribbling touch engine exists yet.
