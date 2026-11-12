# Phase 6.5 — Team-wide defensive intelligence

## User observation and diagnosis

The user confirmed improved open-play passing and stable flank positioning in their iPhone viewer, but observed that when opponents attacked, Harbor #8 could mark an opposing defender far behind the attack rather than dropping toward its own defenders. Other players appeared to press only within their immediate zone.

The former AI assigned pressure by ball-chaser rank, then gave all remaining defenders/wingers/midfielders a **nearest-opponent** marking job around an outdated formation anchor (up to 19m away). It did not assess whether a marked opponent was actually involved in the attack or whether the player should instead recover goal-side. Any eligible player could be nominated as second cover without accounting for holding the defensive structure.

## Implementation

- New pure `src/game/ai/defensive-shape.ts` plans responsibilities for **all 11 players** of the defending team in one consistent metric-pitch snapshot. Each player receives exactly one assignment: `press`, `cover`, `mark`, `recover`, or `shape` (goalkeeper). There is no teleport, forced tackle, or fabricated team result.
- **Goal-side positional recovery:** centre-backs and fullbacks recover into a deeper line, defensive and central midfielders drop between the attacker and their own goal, wingers tuck back on their proper team-relative flank and the striker stays somewhat higher as a potential transition outlet. Movements are calculated from the actual ball position and original role anchor with conservative bounds.
- **Selective pressing:** nearest locally accessible outfield players are considered for pressing with role-sensitive penalties, limiting how easily central defenders abandon their line. High pressing commits up to two, standard one, low presses only within a shorter radius. Actual press outcomes remain physical challenges in the existing contact engine.
- **Goal-side cover:** one different outfield player protects behind the primary presser, instead of everyone independently chasing the ball.
- **Relevant marking only:** opposition outfield players are eligible if they are near the actual attacking phase (not stranded in their own defensive half), close to the defending player's recovery sector, and unmarked. Mark movement is capped to eight metres from the defensive recovery target.
- **Goalkeeper:** remains in a conservative keeper-shaped position, not eligible for the pressing or covering candidate pool. Advanced sweeper-keeper logic is still absent.

The team-wide planner runs only when this AI-controlled team is **defending an in-play ball**. On-ball decisions, scheduled physically executed passes, dynamic attacking support, actual kicking and interceptions, legal kick-off and the current full-screen 2D Canvas are untouched.

The new `recover` decision type is added to strict checkpoint action validation. The state schema and checkpoint schema remain at version **8** (no new state fields), but the engine-version string changes to `o11-defensive-team-shape-p65-v1` to prevent incompatible deterministic replay.

## Tests and limitations

Tests reproduce the user's #8 case in both home and mirrored-away orientation, assert the midfielder returns goal-side instead of tracking an irrelevant defender, verify all players get one role, check that central defenders hold the line while others press, evaluate high/low pressing, ensure actual dangerous players may be marked within eight metres of the recovery shape, preserve boundaries, verify no mutation/contacts during AI planning and test checkpoint replay. Existing full-suite physics, opening kick-off and attacking AI regressions remain mandatory.

**Estimated tactical model:** recovery distances, risk ranges and assignment priorities are designed heuristics. There is not yet a calibrated team defensive-block model, opposition role recognition, coordinated counterpressing traps, professional keeper decisions, offside, player-body collisions, goal adjudication or out-of-play restarts. Pressure does not force interception. A mobile browser performance measurement and visual football-realism review still require real iPhone testing.

The next decision should follow the user's observed defensive movements, **not** automatically introduce yet more systems.
