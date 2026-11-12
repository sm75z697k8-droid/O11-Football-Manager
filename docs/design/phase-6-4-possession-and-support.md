# O11 — Phase 6.4: Intelligent possession and dynamic support

## Goal and observed failure

The iPhone viewer now shows correct home/away flanks and connected physical passes, but players still carry the ball too often. The Phase 6.3.1 decision model imposed a general -2 utility penalty on passes outside the attacking goal area, enforced a 36-tick (1.8 logical-second) global cooldown, and positioned supporting players mainly at fixed offsets. Even with physically correct foot contact and receiver intentions, those heuristics could make teammates poor passing options and encourage solo runs.

## Changes

### Spatial support search

`src/game/ai/support-space.ts` examines a bounded set of nine locations around each player's role-specific support anchor. Real opponent positions, opponent proximity at the candidate, line-segment defensive obstruction, distance from the carrier, passing angle, current teammate crowding, already-reserved teammate targets, current player position and formation displacement influence the selected target. A greedy deterministic allocation reserves chosen locations, reducing the tendency for two midfielders to occupy the same pocket. Goalkeepers are excluded from these support runs, defensive backline players remain anchored deeper, and wide players keep correct **team-relative** flanks.

No artificial teleports or scripted receives: target points are inputs to the existing acceleration and contact simulation. Physical interceptions may still happen, and the first designated receiver remains under the Phase 6.3.1 pass-intent mechanism.

### Context-sensitive passing

`src/game/ai/possession.ts` now distinguishes an actually open short/medium passing corridor from a merely nearby teammate. A receiver with enough separation from defenders and a clear lane earns a limited utility benefit; tighter carrier pressure makes release relatively more valuable. The global pass bias outside the goal area is reduced from -2 to -0.6, while deep backwards passes still have a modest cost unless safer than carrying. Passes through blocked lanes and passes to marked receivers continue to be heavily penalized.

The global minimum spacing between **attempted** AI passes is reduced from 36 ticks to **24 ticks** (1.2 simulated seconds). This is still a pragmatic throttle on an early-stage match engine with a 256-command history cap, **not** an ideal per-player tactical cooldown. Later full-length match rules need bounded history storage before heavy passing can be simulated for 90 minutes.

### Integration and determinism

- The preexisting 12-tick player decision update and 50ms physical simulation cadence are unchanged.
- No changed match-data or checkpoint schema: `MATCH_STATE_SCHEMA_VERSION` remains **8**. The engine implementation version is bumped to `o11-dynamic-support-p64-v1` so incompatible algorithm-version replays reject old snapshots.
- Both teams remain independently opt-in for AI; manual diagnostic simulations are unchanged. The genuine opening kick-off, explicit receiver instructions, defensive pressing settings, single Canvas viewport, player selection, touch controls and out-of-play warning are preserved.
- Crucially, **pressing coordination is NOT redesigned in this milestone**. The user approved starting with passing and dynamic support; defensive changes will be a separate diagnostic milestone based on testing.
- This is a deterministic utility-based planner with uncalibrated football weights. It is not Sports Interactive's proprietary engine, a machine-learned agent or an implementation of goals/shots/rules.

## Tests

Spatial role/flank discipline for both home and away teams, repeatable support choices, choosing a different location in a blocked channel, distinct midfield angles, valid pitch bounds, pass selection with a real lateral receiver, carry decisions when no viable receiver exists, physical-state nonmutation, and deterministic checkpoint replay. Existing integration tests cover scheduled physical passes and attribute-based contact outcomes. CI verifies TypeScript, all Vitest files and the build; the Pages workflow verifies published JS/CSS. These do not establish that iPhone Safari FPS or simulated football realism is satisfactory without on-device inspection.

## Remaining limitations

Footballers can still physically overlap. No shooting, official goals, match restarts, professional marking structures, complex offside lines, or realistic keeper distribution. The match still pauses if the ball leaves play. Passing frequency is **not a success metric by itself**: validate release timing, useful off-ball movement, excessive possession carrying, blocked-pass mistakes and physically completed passes in the real viewer.
