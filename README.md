# O11 Football Manager

A serious, simulation-first football management simulator being developed for full-screen, landscape-first play on iPhone Safari and desktop. Development uses GitHub web editing and GitHub Actions.

## Current milestone: Phase 4 — Automatic ball contact

The shared test fixture includes exactly two fictional clubs, **Harbor Athletic** and **Vale Rovers**, with 11 players each.

- Deterministic 50 ms logical ticks, seeded random streams, ordered command scheduling and versioned checkpoints.
- Physically derived player acceleration, braking, speed and turning.
- Physical ball rolling, gravity, drag, bouncing and pitch boundaries.
- Explicit first-touch and kick attempts, with skill and actual reach affecting results.
- **NEW:** Physical interception/challenge detection across the complete relative ball–player movement segment in a tick (instead of endpoint-only checking). A footballer's `setBallEngagement` intent activates automatic contact detection; no repeated first-touch commands are necessary. Real position, relative velocity and attributes influence interception, deflection and defensive challenges, with single-winner arbitration and cooldown.
- Match state, controls and automatic interaction events restore and replay deterministically.

**Still not a playable football match:** The app has no autonomous tactical AI to choose when to engage, how to move, pass or defend; no formal match clock, goals, offside, fouls, player-body collision or interactive 2D match renderer. The website remains a temporary development preview with an illustrative pitch, not real match visualization. Physical body overlaps remain possible; the new contact resolver only arbitrates *ball* interactions.

## Build checks

GitHub Actions validates TypeScript, all Vitest tests, the Vite build and production assets; Pages deployment checks live HTML, JS and CSS over HTTP. Keep GitHub Pages source set to **GitHub Actions**.

Available scripts: `npm run check`, `npm run benchmark:foundation`, `npm run benchmark:motion`, `npm run benchmark:ball`, `npm run benchmark:contact` and `npm run benchmark:auto-contact`.

Benchmarks run on GitHub's Linux Node runner. They are NOT iPhone Safari or real football-match frame-rate measurements.

[Phase 4 technical design](docs/design/phase-4-automatic-contact.md)

Live preview: https://sm75z697k8-droid.github.io/O11-Football-Manager/

The eventual 2D match viewer must render this exact authoritative engine state; no fake passes or predetermined outcomes will substitute for actual simulation.
