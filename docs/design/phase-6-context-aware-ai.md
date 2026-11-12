# Phase 6.2 — Context-aware decisions in possession

## User-reported failure

In the live iPhone 2D viewer, the basic Phase 5 AI regularly ran with the ball directly towards goal and eventually out of play. The main defects were not in player animation: on-ball selection only initiated a pass within 8 metres of a defender, and the previous pass picker rejected virtually all backwards options. The carry target was always forward and had no meaningful pitch boundary, passing-lane or pressure assessment.

## What has changed

A focused, pure, deterministic **utility-based possession planner** now sits in \`src/game/ai/possession.ts\`, separate from physics, commands and Canvas.

Every permitted AI cycle, the current ball carrier assesses:

1. **Carry routes** — forward, forward-diagonal, sideways, backward-diagonal and shield/hold. All use the pitch's metric dimensions, defender position relative to the route, dribbling ability, balance/composure, available space, and estimated distance to the pitch/goal boundary. There is a safe zone several metres inside the lines.
2. **Pass outlets** — any relevant teammate within 3–39 metres, including backward or sideways outlets and goalkeepers. The model considers passing, vision and decision attributes; how open the intended recipient is; actual intervening defenders along the passing lane; relative progress towards the opponent's goal; and distance-dependent complexity.
3. **Comparison** — the best carrying and passing utilities are compared, with mild anti-pass-spamming bias and an increased preference for circulating possession near the unimplemented goal-line rules. There is no scripted destination, hardcoded preferred teammate or guaranteed result.
4. **Execution** — when a pass is selected, the AI queues the SAME authoritative \`attemptKick\` request as before, and actual kicking, ball motion and interception systems determine the result. A selected pass can be misdirected, blocked, intercepted or missed. Carrying remains a movement target governed by acceleration and turn physics.
5. **Supporting play** — attackers offer slightly more relevant support by adjusting relative to the current carrier, while keeping formation anchors.

The existing 12-tick decision cadence and 36-tick pass cooldown are unchanged. AI remains disabled by default in headless match setups and is enabled explicitly in the viewer. The opening kickoff still freezes all agents until the centre pass physically moves. The full-screen landscape Canvas and all current controls are unchanged.

The new utility scores and coefficients are **simulation estimates, not probabilities, learned policies or calibrated performance models**. The path check approximates defensive passing lanes; it does not predict actual future interception or guarantee teammate safety. The choices are based on real positions rather than a scripted sequence, but remain significantly simpler than advanced professional tactical decision-making.

## Checkpoint compatibility

No new state fields were needed: the state/checkpoint schema remains v7. The \`FOUNDATION_ENGINE_VERSION\` string changes to \`o11-context-aware-possession-v1\`, so prior algorithm-version saves explicitly reject rather than silently replaying with different AI decisions. There are no persistent user career saves to migrate yet.

## Explicit limitations

- No goal scoring, shot decision, referee, restart, official match clock, offside or full goalkeeper behavior. A shoot action is deliberately not faked before real goal adjudication and shooting mechanics exist.
- The viewer still pauses when the ball crosses outside the pitch. Better choices should reduce accidental dribbles over the goal line but **cannot** create missing restarts.
- No advanced lookahead passing prediction, offside lines, passing-speed anticipation, player body collision, marking assignments, stamina depletion or possession statistics.
- The command log is still limited to 256 issued commands; long complete matches require bounded event history or save compaction.
- No iPhone FPS or in-game realism verified by Node tests. User must actually observe the updated live match on Safari.

## Validation plan

- Unit tests for pressure, unobstructed vs blocked passing lanes, backwards/sideways outlet selection, carrying to open space, avoiding unsafe edge targets, deterministic repeatability and pass cooldown.
- Original AI, opening-kickoff, state replay, physical ball and locomotion tests remain in CI.
- Real 1,000-tick fixture baseline confirms any pass attempts still enter the existing physical contact system (not a fabricated event).
- GitHub Actions checks TypeScript, Vitest, Vite build and published assets. Safari testing remains separate.

## Why no extra UI system

The project needs to observe credible movement with the existing full-screen pitch, not build cosmetic passing animations. This change alters AI decisions only, leaving the renderer and physics as the single source of truth.
