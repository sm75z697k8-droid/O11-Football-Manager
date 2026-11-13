# Phase 6.9J — Long-match command capacity and seed-specific stall investigation

## User report

On iPhone, seed `8BE673A4` reportedly appeared to become stuck at or after **09:42**, while PHYSICAL CONTACTS still increased. This could indicate stationary contested possession with recurring interactions, an AI action limiter, poor mobile UI frame pacing, or a different running build. The current simulation does not include throw-ins, so an out-of-play ball normally ends the exhibition.

## Exact-seed replay: what was and was not reproduced

- Convert the displayed hexadecimal seed `8BE673A4` to the unsigned 32-bit integer `2347135908`.
- The current Phase 6.9I engine, using a real `MatchViewerSession`, reaches tick **5968 (04:58.4)** and `ball.outsidePitch === true`. It records **137 applied commands**, **168 automatic contacts**, and the last real kick at tick **5942**. The engine stops this exhibition properly when the ball leaves the pitch.
- A separate historical branch based on the earlier **Phase 6.9H** merge commit reproduced **exactly the same terminal state**; the historical diagnostic PR was closed without merging.
- Therefore the user's **09:42 ongoing-contact stall is not reproduced** by that seed on either tested version. It may involve a different deployed client, a run with a different starting state, or another bug. The results must not be described as proving a fix for the specifically reported incident.

## A distinct confirmed silent-stop defect

The command scheduler contained a **hard 256 total-command limit** (`MAX_COMMANDS_PER_MATCH`) used for all valid scheduled commands, including team AI passes, shots and GK throws. The AI runner also checked `nextCommandSequence <= MAX_COMMANDS_PER_MATCH` before issuing new kicks. Once reached, it would silently stop attempting real kicks. A running match could still advance the clock, move players, and produce automatic contact events; this is a real, independent source of apparent late-match action stalls. The 256 limit was only appropriate for short engine tests.

The capacity is now **8192**. This is a bounded safety limit chosen to accommodate substantially longer simulated periods, not measured authentic real-world command volume. Full match-duration performance and a true rolling event journal remain future work. If that limit is ever exceeded, the autonomous AI raises an explicit error so the viewer displays a failure rather than silently removing all passes/shots.

**Checkpoint security:** schema version 9 stays intact, command IDs remain unique, full histories are still validated (strict sequential sequence numbers, target timestamps, ownership and command shape). The deterministic algorithm `engineVersion` is incremented because command-cap behaviour changes; old checkpoints should not be misinterpreted as the new algorithm.

## Mobile repro observability

A small **BUILD 6.9J** label sits next to SEED in the match HUD. The player inspector shows `COMMANDS USED` against the new limit and includes a user-initiated **Copy match debug report** button. That produces a local JSON string with `seed`, `engineVersion`, clock tick/time, ball/controller, last physical kick/throw, the latest automatic contacts, and action counts. The report is never uploaded automatically and includes no user account or location information. It can be pasted into a chat from Safari without a desktop computer. Existing match physics and event ordering remain authoritative.

## Verification and limitations

- A regression test issues **270 genuine, validated scheduled team commands**, advances actual command scheduling, checks 270 applied commands, creates/restores a checkpoint, and successfully schedules an additional 271st command. This failed with the old cap and passes with the new value.
- A dedicated exact-seed integration regression logs real state at 1600-tick intervals and identifies the genuine out-of-play exit at tick 5968, rather than inventing a 09:42 stall.
- The diagnostic helper is tested for a valid seed/version/tick and nonmutation. Both AI teams are verified enabled in a real viewer session.
- All existing physical passing, goalkeeper handling, attacking, fixed-step, deterministic replay and iPhone UI tests must pass before merge.

This phase **does not** add throw-ins, corners, goal kicks, a full-match event journal, additional player AI intelligence, or guarantee that the user's unmatched 09:42 freeze is resolved. If the issue persists on the current build, the next action is analyzing the copied report and exact match clock state from that build.
