# O11 — Phase 0D: authoritative foundation match state and commands

## Scope

- Initialize **exactly two fictional clubs**, Harbor Athletic and Vale Rovers, with 11 starting agents each from the validated Phase 0B fixture.
- Own one MatchState with player IDs, team IDs, metric initial coordinates, static ball, seed-derived checkpointable RNG streams and the Phase 0C fixed-step clock.
- Process deterministic, validated manager command requests using next-tick scheduling and stable per-match sequences.
- Support one provisional command: `setPressingIntensity`. It modifies **stored tactical preference only**. It does not affect player behavior until tactical AI is implemented.
- Make full state/setup checkpoints that can be JSON serialized and restored. Keep internal engine references private; external snapshots are detached copies.
- Validate checkpoint versions, teams, participants, ball, streams, commands, schedule and team tactical consistency.
- Protect browser responsiveness with a maximum of 10,000 logical diagnostic ticks per `advance` invocation. No wall-clock timer is involved.

## Deliberate nonfeatures

- Match period remains `notStarted`. Diagnostic ticks are NOT official elapsed football match time.
- No player movement, ball physics, possession, goals, goalkeeper logic, football laws, live statistics or AI decision-making.
- No invented match highlight animations. Initial static 4-3-3 coordinates are **reference markers, not live football actions**.
- No match viewer in Phase 0D. A future **landscape-first, full-screen** Canvas 2D viewer must use the *same MatchState* as the engine, not separate visual teams.
- No extra clubs simulated offscreen. Longer-term, additional AI clubs can run headless under supported simulation rules, but not yet.

## Test/acceptance

`npm run check` must pass in GitHub Actions. Verify all 22 unique players initialize with valid metric positions; external object edits do not mutate engine state; invalid commands are rejected without changing state; commands execute once in stable sequence at their target tick; malformed checkpoints fail validation; complete checkpoint/restore exactly reproduces deterministic continuation; and large diagnostic tick advances never fabricate scores, match time or movement.

## Next milestone

Phase 0E is final regression/release validation. Then phased physical 2D movement and match rules development can begin. Do not implement Phase 0E until separately approved.
