# O11 — Phase 6.3.1: Team-relative flank discipline and deliberate physical passes

## Reported behavior

On-device test screenshots show the receiving footballer unable to combine after kick-off, left and right players crossing into each other's zones, and a Vale player striking a pass toward seemingly empty space.

## Root causes

The source formation in `match/setup.ts` mirrors **both x and y axes** for the away team, preserving team-relative left/right positions. The Phase 6.3 `supportTarget` function incorrectly reused home-screen Y signs for *both* teams, which could make away right-sided players run to the left and vice versa. Wide/fullback/central midfield support additionally had no stable lateral channel restriction.

The possession planner selected a pass **target point** but the authoritative state did not identify the intended recipient. Teammates independently chased the ball with 12-tick decision cadence (0.6 simulated seconds), allowing the ball to outrun its supposed receiver. A minimum kick-power threshold also caused short passes to be hit harder than the intended meeting distance required.

## Changes

1. **One coordinate convention.** Formation slot right/left is interpreted in the *team's attacking direction*: home +X has right flank +Y; away -X has right flank -Y. Kick-off support options for the away team mirror accordingly. Midfielders are allowed to narrow but remain on their own half of pitch width; wingers and fullbacks preserve their flank.
2. **Bounded explicit pass intent.** `AIState.passIntent` stores exactly one pending/recent AI kick: its real command ID, passer ID, intended receiver ID, owning club, requested tick and original physical target. This is metadata for coordination, **not** an awarded pass. Pass requests remain the existing validated `attemptKick` command.
3. **Receiver moves with actual physics.** A selected receiver engages the ball when a kick is queued and receives the same target as the kick. Once a physical kick has been recorded, the receiver estimates a reachable interception location from the ball's actual velocity, acceleration, height and 50ms simulation clock, updating every tick. A teammate/opponent touching the ball, failed attempt, out-of-play or 80-tick (4s) age retires the instruction. The 12-tick team AI decisions remain intact.
4. **Calibrated initial kick requests.** AI kick power uses the *actual Phase 3 kick-speed equation* and ground-roll deceleration to set a desired speed based on the real player-to-target distance. The physics engine still independently calculates accuracy and may generate error; no guaranteed completion, artificial reception, fake stats or scripted tactical sequences.
5. **Explicit versioning and checkpoint validation.** New schema/checkpoint v8 validates the pass intent against its real physical kick command, its club and receiver identities, bounded target and plausible timing. The engine implementation version is also bumped to prevent incompatible replay. Prior v7 checkpoints intentionally fail; there are no persistent user careers yet.

## Tests and limits

New unit tests cover both teams' relative right/left roles across extreme ball-side locations, mirrored kick-off formation, an engaged intended receiver, changing reception targets, lost/failed pass retirement and expiration. Integration tests find an actual AI kick and verify the real receiver instruction, next-tick physics, deterministic save/restore and forged checkpoint rejection. Existing physics, AI, legal kick-off and full-screen viewer regressions run in GitHub Actions.

This is still a limited model. It does not implement real-time optimal-pass trajectories, through-ball race predictions for 22 players, offside awareness, shooting/goal rules, goalkeeper sweeps, spatial body collisions, tackling fouls, or proper restarts. A real pass can still miss and a marked receiver may legitimately fail. Performance on actual iPhone Safari requires direct user observation after CI and Pages deployment.
