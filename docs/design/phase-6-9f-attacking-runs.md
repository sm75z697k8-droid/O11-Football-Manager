# Phase 6.9F — Final-third off-ball attacking half-space movement

## Finding
Both wingers' regular support positioning kept them close to the touchlines (roughly 7.5 metres from each sideline). That was sensible build-up width but deprived the short-horizon shot planner of central/wider-channel options, especially given its requirement for reasonably central goal angles. Many simulated sequences had only 0–2 actual shots and never triggered goalkeeper physical contact.

## Decision
Add a small, finite candidate set of **half-space winger runs** in the existing team-support allocator, only when a teammate actually controls a ball 9–34 metres from the opposition goal. Preserve one traditional wide outlet and allow the less-marked / weak-side winger to explore a half-space run. Score each possible movement destination using current defender spacing, obstructed passing corridor, teammate clustering, travel distance and a *prospective* goal-shooting corridor from that location. Compare against the existing wide-outlet targets rather than automatically relocating the winger. The approach checks for a clear actual defender-free lane before the inside cut and caps the target's displacement to 18 metres per tactical refresh to prevent sudden unrealistic remote movement instructions. This is a decision about where a real player should run, not an awarded goal, completed pass or shot.

The candidate's forward position is capped using the ball and approximate second-last defender locations to avoid blatantly unrealistic behind-defence targets, but football offside itself is **not implemented** and this heuristic must not be interpreted as an official offside decision.

The same search works for teams attacking either +X or -X using team-relative flanks. The system retains broad player roles: defenders, the keeper and midfielders use their previous support strategy; wingers can continue offering width when conditions favor it.

## Validation
- New unit tests stage genuine final-third ball ownership vs deep build-up vs opposing possession, flank discipline, deterministic repetition and physical checkpoint replay.
- Existing seeded match diagnostics report shots only when kicked by a real agent, and keeper saves only after actual caught/parried contact events.
- Performance remains bounded to at most one designated winger and six extra candidate targets per tactical refresh, with no extra physics loops or render-time computations.
- Existing real passing benchmarks, kickoff, goal adjudication and GK handling must remain green in CI; verify later in iPhone Safari.

## Limitations
No real offside officiating, tactical cross-and-cutback plays, 3D goalkeeper dives, set-piece restarts, official calibrated xG, or full match periods. The finite candidate pool and utility coefficients are estimated tactical heuristics subject to future balancing, not match outcome scripts.

## Same-seed observational diagnostic (GitHub Actions, not Safari)
Compared with the passing/goalkeeper-handling `6.9E` baseline across nine fixed-seed seeded exhibition runs, this version produced **14 physically kicked shots** (baseline 13) and **4 recorded goalkeeper catches** (baseline 3). It also retained the existing physically controlled passing regression checks (81/98 under 18m and 124/159 overall in that diagnostic). These differences are small, may vary in longer matches, and do not prove real-world calibration or guaranteed match results. The seeded fixtures have no full restart rules; out-of-play still stops a run.
