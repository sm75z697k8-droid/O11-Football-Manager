# Phase 6.9O — Defending with intent rather than endless ball chasing

## Player observation and verified baseline

The user reports that teams press excessively. The earlier defensive planner nominated one standard or two high-intensity pressing players using **unconditional 30m/38m radii** around the ball. They were then instructed to move directly to its current position. Even when not nominated, a covering defender could be told to run a long way toward the ball. Twelve-tick team replanning could also switch the pressing player when a teammate became fractionally nearer.

**This was a tactical-planner issue, not an excuse to slow the locomotion model or randomly weaken tackling.** The actual contact physics, real ball ownership, shot/goal systems and 6.9N close control are unchanged.

## Implemented behaviour

The one-team defensive planner in `src/game/ai/defensive-shape.ts` now selects from local physical candidates using **pressing intensity, position relative to the defending goal, a wide touchline trap, genuine goalward carrier velocity, a recently controlled touch, and proximity to a real challenge**.

- **Low:** generally maintains formation. Close-in tackles and emergencies inside 26m of the team's own goal can still justify a single pressing player.
- **Standard:** a player simply being inside 30m of the ball is no longer sufficient. Pressing needs close physical range, real goal threat, a meaningful turn toward the defending goal, a touchline trap or a recent real reception. A player not nominated to press may still screen and contain without engaging the ball.
- **High:** allows much more eager pressure within a smaller calibrated radius than before. A second runner directly engages only in a **legitimate trap** (wide, recently received, or deep defensive danger). It is not a mandatory second player sprinting at every carrier.

The eligible presser ranking includes a modest **3.5m continuity margin** for the previous nominated player so 0.6s reviews do not automatically swap the presser for an almost equally near teammate. A clearly better/eligible player can still replace them. Centre-backs protect their shape rather than sprinting into non-dangerous midfield areas, unless they can genuinely intervene from near-foot range. Nomination never awards a tackle or possession: all contact is decided in the existing 50ms physics engine.

The primary press approach initially seeks a **goal-side screening point** approximately 1.9m goalward of the carrier rather than rushing straight at the ball from afar. Once within 3.5m, its target is the actual physical ball for a legitimate challenge. **The cover runner** is kept within an estimated displacement of **7m (low), 10m (standard), or 13m (high)** of their own defensive recovery point. Therefore assigning `cover` does not itself become another long-distance chase, and all remaining defenders keep meaningful recovery, marking, screening and shape roles.

**Loose-ball pursuit remains separate**: when the ball is physically free, the real nominated recovery player can still pursue it for either team. This stage does not reduce the fundamental existing chase for a lost/mispassed ball.

The tactical weights and distances are deliberately described as **estimated simulation heuristics, not calibrated data** from professional matches. Player energy continues to influence locomotion limits as before, but the game does not yet simulate true cumulative pressing stamina/fatigue or independently resolve a jockeying defensive posture.

## Tests and regression management

- **14 direct mirrored tactical unit tests**: harmless possession tolerated, open-space no press, genuine wide high trap with two pressers, urgent home/away goal pressure, non-teleporting goal-side approaches, bounded cover displacement at all intensities, sticky-but-not-permanent pressing responsibility, genuine post-touch pressing, real loose-ball recovery and pure no-fabrication plan.
- **One live integration test** runs two real fictional seeded matches at **each of low, standard and high**, using actual `setPressingIntensity` match commands, both autonomous XIs, the real kickoff and 50ms locomotion/contact; no invented results, scripted tackles or fantasy match statistics.
- Previously rigid tests that demanded high press **always** use exactly two chasers have been updated to cap it at two while separate genuine trap tests demand two under justified conditions.
- Old live goalkeeper catch tests continue to require **actual** swept catches and throws and exact checkpoint replay. The search now tries a confirmed-catch seed first to avoid excessive CI delay when changing physical match trajectories.
- A user-supplied frozen-match diagnostic still verifies legitimate stoppage versus command exhaustion. It now records a genuine final snapshot when this new match trajectory stops before the historical 1,600-tick sample.

Final pre-documentation CI: **360/360 tests across 59 files**, strict TypeScript and Vite production build all succeeded.

## Measured short-match diagnostics (not professional-match claims)

In a **very small** sample of two seeds per intensity (up to ~1,040 ticks per match), defending-team pressing snapshots when an opponent held the ball were:

| Setting | Seed 42 frames pressed / controlled | Seed 90 frames pressed / controlled | Frames with two pressers |
| --- | ---: | ---: | ---: |
| Low | 10/48 | 7/50 | 0 |
| Standard | 9/11 | 55/68 | 0 |
| High | 35/37 | 52/62 | 16 and 19 |

These samples have **different underlying match trajectories** at each intensity; they are not direct observations of the same event under three conditions. The standard samples still include a high fraction of active pressure near contested parts of the pitch; this stage should be considered a **disciplined primary presser / covering movement improvement**, not proof of fully realistic pressing frequency. Further tactical triggers, defender body positioning and real pressing stamina are likely needed after gameplay observation.

The standard **nine-seed** physical attacking smoke benchmark also changes because possession and defence interact:

| Genuine observed event | 6.9N | 6.9O |
| --- | ---: | ---: |
| Physical kicked shots | 5 | 7 |
| Actual goals | 1 | 0 |
| Keeper catches | 1 | 2 |
| Intended receiver controls | 148 / 171 | 157 / 184 |

The nine-seed sample is far too small and nonlinear to claim a statistically measured improvement or that removing pressing reduces goal scoring. No code manufactures match scores or on-ball outcomes.

## Compatibility, performance and iPhone acceptance

- Engine algorithm identity `o11-disciplined-pressing-p69o-v1`; **checkpoint schema remains v9**. The version prevents silently treating an old deterministic saved match as the same newer simulation.
- One team plan per legitimate scheduled cycle; no new perpetual per-physics-tick tracking. Reverse scans of genuine first-touch events replace full-log allocations to help iPhone Safari memory.
- No changes to on-ball physical contact, short-horizon shot selection, 6.9N close control, goalkeeper saved hands, ball flight, goal adjudication, rendering or interface.
- Refresh the GitHub Pages match viewer and confirm **BUILD 6.9O**. Look for fewer unrelated defenders chasing harmless central circulation, a more compact covering player and realistic emergency responses near goal. With high pressing, two close-down players should appear most often around relevant traps, not every possession.
- Capture the **Copy Match Debug Report** seed/tick and describe whether pressing is too frequent, too passive, or switching players strangely. Mobile visual testing has not been performed by GitHub Actions.
