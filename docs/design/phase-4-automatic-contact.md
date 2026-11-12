# O11 Football Manager — Phase 4: Swept ball interception and challenges

## Purpose

Phase 4 adds automatic *physical resolution* of intended ball encounters. It is still a **headless diagnostic simulation**, not a self-playing football match. The existing two fictional test teams, Harbor Athletic and Vale Rovers, retain one authoritative match state, 22 unique players, one physical ball, determinism, and versioned checkpoints.

## Approach

**Engagement intent:** Each player has an explicit `engagesBall` flag, default **false**, updated through the existing `setBallEngagement` command. Tactical AI is not yet implemented, so this input represents a future agent's decision to try engaging. The flag persists until changed. No per-tick manual first-touch command is needed once the player is engaged. This prevents unengaged players from gaining magical possession just by proximity. Existing explicit first-touch/kick diagnostics remain valid.

**Swept collision:** The physics resolver compares the previous and next positions of ball and each engaged player. It finds the first time a 2D relative movement segment enters reach, with an approximated within-tick ball-height gate. This prevents a ball crossing a player's space between 50 ms samples from passing unnoticed. The player and ball use the same 105 × 68 m metric coordinate model; the radius of foot reach is 1.05 m, with maximum ball-centre height 0.45 m. A ball already completely outside the pitch cannot be intercepted.

**Deterministic arbitration:** Eligible contact candidates are sorted by time of entry, separation and a stable player-ID lexical tie-break, independent of iteration order. At most one candidate resolves on a tick; a six-tick estimated cooldown prevents repeated interactions caused by the same overlap. An explicit successful Phase 3 contact takes priority within its tick, and diagnostic ball resets bypass automatic contact.

**Free-ball contact:** Interception control compares first touch, technique and anticipation against incoming relative ball speed and contact separation. Stronger conditions attach the ball to the actual player location and velocity. Difficult/high-speed impact deflects the physical ball with a measured contact position and a simplified impulse. It does **not** invent a goal, foul, possession statistic or pass.

**Controlled-ball challenge:** An engaged opponent can contest a player's physical ball position. Tackling, anticipation, strength, balance, dribbling and composure determine whether the defender wins possession or the current owner holds the ball. Same-team players are excluded from challenges and only one controller is permitted. The approach term uses actual relative velocities. These are initial estimated contact mechanics, not a calibrated tackle simulator.

**Save/replay:** Successful/failed automatic contact results have their own ordered `automaticContactEvents` log, separate from Phase 3's command-triggered contact events. These events use no random draws; existing seeded first-touch and kicking RNG streams keep their previous semantics. Each checkpoint validates engagement commands, physically plausible ball control, chronological automatic events, cooldown, and outcome-consistent owner identity. Schema v5 rejects older v4 snapshots explicitly, since no persistent user career saves exist yet.

## Limitations and further work

- Player–player **body collisions and spatial exclusion are not implemented**. Phase 4 arbitrates **player–ball** contacts to prevent simultaneous ownership; players can still overlap. Body physics requires a separate, focused integration with locomotion.
- Players do not autonomously seek the ball, choose passes, intercept based on field awareness or decide when to attempt tackles. Engagement and movement intent currently come from diagnostic commands; future tactical AI will supply these.
- Ball path and height between ticks are approximated by a straight segment. Spin, curving trajectories, complex foot mesh, and exact time-of-impact integration of subsequent motion are not implemented. Incoming free-ball deflection resets position to the detected contact point at the end of the tick; detailed sub-tick continuous impulse integration remains future work.
- There is no referee or foul adjudication, contact injury, game clock, scores, offside, team tactics, possession statistics, playable match viewer or management UI yet.
- Values such as reach, cooldown, and skill thresholds are **estimated simulation calibrations**, not official football measurements.
- This release is expected to preserve the existing browser developer preview; the eventual landscape-first Canvas match viewer must render the **same authoritative state** rather than cosmetic scripted animations.

## Verification

GitHub Actions runs TypeScript, all Vitest tests and compiled asset checks. The Pages deployment job verifies the source and live HTML/JS/CSS responses. New tests exercise fast-ball sweeps, height gating, moving players, stable arbitration, opponent challenges, no automatic action without engagement, checkpoint tampering/replay and the existing diagnostic contact behavior.

The optional Phase 4 diagnostic workload uses Linux Node on GitHub Actions and cannot establish iPhone Safari FPS, real match performance or long-term career scalability.

Further development requires separate approval.
