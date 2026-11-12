# O11 Football Manager

A long-term, simulation-first football management game under construction for **landscape-first full-screen** iPhone Safari and desktop. The entire project is maintained through GitHub on an iPhone.

## Phase 5 — First autonomous football decisions

The engine still uses exactly **two fictional clubs**: Harbor Athletic and Vale Rovers, with 11 starting footballers each.

- Metric pitch and player attributes, 50ms fixed-step simulation, seeded deterministic random streams, versioned checkpoints and command scheduling.
- Physical players accelerate, turn and brake; the ball rolls, flies and rebounds; controlled first touches, kicks, interceptions and opponent challenges use actual positions.
- **NEW:** Basic decision-making agents can be enabled for either team through `setAutonomousTeam`, default **off**. Agents choose physically bounded targets for pursuit, pressing, carrying, formation recovery and support. Their decisions are reassessed every 12 fixed ticks, rather than continuously generating command history.
- Pressing intensity changes how many footballers chase the ball. The owner can choose a teammate under pressure and attempt an ordinary physical pass through the real kick and contact mechanics. Outcomes are not predetermined.
- The AI state and decisions are checkpointed and replayed deterministically, with version 6 checking team opt-in history.

**Still not a playable match:** There is no complete competitive clock, rules/referee, goal adjudication, keeper AI, offside, body collisions, restarts, deep tactical decision engine, season management or interactive 2D renderer. The website remains a **temporary development preview** with an illustrative pitch, not actual gameplay footage.

A tactical AI decision **is not** guaranteed football success: contact, kick direction and defensive challenges depend on the existing physics and attributes. Formation logic is intentionally basic and **estimated**, not calibrated professional match behavior.

## GitHub verification

CI runs `npm run check`, including TypeScript, all Vitest tests and the production build asset verification. The Pages workflow confirms live JS/CSS deployment. Keep Pages source set to **GitHub Actions**.

Optional Node-only information: `npm run benchmark:ai`. This does **not** establish iPhone Safari FPS or playable match performance.

[Phase 5 design and limitations](docs/design/phase-5-autonomous-decisions.md)

Preview: https://sm75z697k8-droid.github.io/O11-Football-Manager/

The next step should make actual engine motion observable via an authentic landscape-first 2D canvas viewer; no scripted cosmetic animation will substitute for physics.
