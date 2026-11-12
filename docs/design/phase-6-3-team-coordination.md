# O11 Football Manager — Phase 6.3: Coordinated off-ball team intelligence

## What was wrong

The user observed a genuine kick-off pass that failed to connect, one scripted midfield receiving option, and almost no collective support, defending or pressing.

The Phase 5 planner only targeted the **current** ball position. An incoming pass often pulled its receiver *away* from the future contact point. With no ball owner, both teams mostly treated their remaining players as static shape-holders; when possessing the ball, supporting teammates moved along simple anchors. The defending side rarely coordinated a second cover defender or nearby marking assignments.

## What this release introduces

### 1. Predictive physical reception

The pure module `src/game/ai/coordination.ts` estimates future ball locations from **existing** gravity/ground-friction constants. For ground balls, predicted displacement uses the same analytic rolling-deceleration equation as Phase 2. For airborne balls, it only uses a basic ballistic estimate; it does not claim to predict bounces or spin.

For each eligible footballer, it samples candidate arrival times up to 3.2 seconds. Player acceleration, top speed, initial motion and foot reach define an **estimated** reachable distance. The player with the earliest reachable intercept becomes the first pursuer, and their movement target is a **future ball location**, not the current location. The actual physical match engine still decides whether an interception occurs, whether the ball is controlled, and whether a pass fails. The opening kicker is excluded from immediate second-touch attempts until somebody else touches the ball.

### 2. More than one kick-off option

The legal starting formation now places both `RCM` and `LCM` at separated, nearby short-passing positions behind the opening striker, alongside the deeper `DM` outlet. A simple deterministic weighted comparison of `firstTouch`, `technique` and `anticipation` selects the **initial intended recipient**, rather than hardcoding the right central midfielder. The kick remains an actual `attemptKick` with seeded execution variation; its success and subsequent contact are not prearranged. Both teams remain in their own halves before the kick, and opponents are outside the required centre-circle distance.

### 3. Support roles coordinated around actual possession

The team that most recently played a **free ball** can anticipate likely reception, so players do not become passive just because the ball currently has no controller. Midfielders offer **two distinct angles** to the carrier or expected receiver, the holding midfielder gives a recycling option, the wings maintain width, the striker looks ahead of the ball, and defenders provide deeper structure. These are estimated reference positions, not guaranteed completed passes.

### 4. Defense in layers

The nearest viable defender presses based on travel-time estimates; **high pressing** commits two. The next eligible defender provides goal-side **cover**, while nearby remaining footballers take unique limited-distance **marking** assignments if appropriate. Goalkeepers stay out of the general chasing pool.

This is a lightweight local-team-coordination layer, **not** a full team tactical solver. There are no physically resolved player-body collisions, counter-pressing traps, offside awareness or complex keeper responses.

## Invariants and compatibility

- The existing physical simulation still runs at **50 ms per tick** and the autonomous planner at **12 tick intervals**.
- No renderer-side scripted runs, teleports, preselected match scores, fake touches, forced passing completion or fabricated events.
- Pure module produces bounded `Point2` intentions using metric pitch geometry and player attributes; all changes execute via authoritative locomotion/contact.
- `MatchState` retains **schema version 7** without new fields; `FOUNDATION_ENGINE_VERSION` changes to `o11-coordinated-team-p63-v1`, preventing old checkpoints from silently replaying with different AI policies. Checkpoint validation admits the new `receive`, `cover` and `mark` action types but still enforces shape, unique player IDs, pitch bounds and AI opt-in history.
- When autonomy is **disabled**, the old manual-only behavior and validations stay intact.
- The current full-screen pitch/UI and all playback controls remain unchanged.

## Validation and known limitations

Tests cover physical ball prediction, interception target lookahead, two legal opening midfield options, role-dependent support and defensive cover, skill-based initial recipient selection, and a real automatic interception of the opening pass. Checkpoint-replay regression protects deterministic behavior; existing football physics, commands and viewer tests still run.

The model still lacks goals, shooting, referee calls, throw-ins, corners, goal kicks, official clock, advanced offside logic, player-player physical separation, set pieces and tactical formation adjustments. A ball leaving play still produces the existing truthful pause/Reset notice.

All numeric ratings and decision weights remain uncalibrated **simulation estimates**. GitHub CI and Node performance can establish functional and deterministic correctness, **not iPhone Safari frame rate or realistic football quality**. Actual visual behavior needs user feedback.
