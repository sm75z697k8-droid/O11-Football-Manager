# Phase 6.9H — Next-action value for physically viable attacking passes

## Observation
The possession AI already previews the first pass against real physical ball and receiver movement. It also estimates whether the reception position has a better angle to the goal. But selecting a pass because the destination itself looks promising is not the same as assessing what the receiving footballer can do under actual nearby defensive pressure. Several combinations and newly created forward runs were rarely used effectively.

## Scoped improvement
`receiver-continuation.ts` is a pure tactical evaluator. Called **only after the existing physical first-pass viability filter**, and during the existing bounded short-horizon option review, it estimates a **single next action** from a receiver's projected arrival position and nearby players' estimated locations:

1. A direct shot, considering credible shot range, angle, finishing/composure and the actual defensive shot corridor.
2. A short, safe forward carry that materially improves expected shooting access, using actual defender spacing and a bounded movement corridor.
3. A geometric next passing option to a distinct advanced teammate who is reachable, open and able to offer meaningful further progress.

The strongest of these forecasts provides a bounded utility adjustment to **the original pass option**. A receiver who appears immediately crowded, or who has no credible continuation near the attacking third, offers no artificial bonus and may get a small caution penalty. The passer can still carry, shoot or protect possession. Forward vision, decisions, first touch and composure affect these estimated judgments without guaranteeing a successful outcome.

These are deterministic *estimated tactical values*, not calibrated probabilities, virtual shots, lookahead simulations of ball possession, synthetic expected goals or programmed pass sequences. The engine never creates an event from the forecast. A second pass must independently pass the normal physical reach, command and interception systems on a future tick.

## Safety and performance
- At most the previously bounded 20 on-ball options are evaluated, with up to three short carry targets and one opponent scan per advanced teammate for each physically viable attacking pass. No new render passes or full branching simulations.
- The model only produces this extra value within 36m of goal. Deep midfield retains its existing tactics.
- The receive-point and defender positions are from the 1.6-second existing movement forecast. Receiver/ball mismatch reduces the utility contribution, avoiding rewards for an impossible teleport to the target.
- Existing defensive AI, true shot and goal adjudication, goalkeeper hands, football replay and opening kickoff remain untouched.
- Engine algorithm version changes to protect saved replay compatibility; serialized schema remains 9.

## Verification
Staged tests verify direct shots, third-man continuation, impossible pressure, deep-pass neutral values, action ranking using real different teammate positions, no fabricated event, and repeatable checkpoints. Full CI must remain green; nine-seed realistic flow must retain actual kick/pass and keeper contact diagnostic quality. iPhone Safari gameplay and CPU/FPS require user validation.
