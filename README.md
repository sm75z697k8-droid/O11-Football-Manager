# O11 Football Manager

A serious simulation-first football management game for **full-screen landscape-first** play on iPhone Safari and desktop. All development is possible with GitHub's web editor, GitHub Actions, and an iPhone.

## Current development: Phase 2 — Ball Physics

- Exactly **two fictional teams:** Harbor Athletic and Vale Rovers, eleven players each.
- Canonical player data, deterministic 50ms ticks, seeded random streams, command scheduling and versioned match state.
- Physical player movement from acceleration, sprint speed, turning and braking abilities.
- **Free ball physics:** ground rolling and friction, airborne gravity, estimated air resistance, turf rebounds and whole-ball pitch-boundary detection.
- Complete checkpoints and deterministic regression tests.
- The new diagnosticBallLaunch command provides initial velocity to test physics. It is NOT a simulated kick, pass, shot or player contact.

**Not yet implemented:** autonomous tactical AI, player–ball contact, official match time, goals, rules, full 2D viewer, career mode or user saves. The published site remains a **temporary developer preview**, not actual playable match footage.

The authoritative football state is shared by future match visualization and headless simulation. No cosmetic football animation should be passed off as real gameplay.

## Testing and deployment

The Actions CI checks TypeScript, Vitest, compiled build files and scripts. GitHub Pages must publish via **GitHub Actions**, not Deploy from a branch, to avoid the previously reported blank white screen. Deployment also verifies that the live HTML and JS/CSS files return HTTP 200.

Available scripts: npm run check, npm run benchmark:foundation, npm run benchmark:motion, npm run benchmark:ball.

Benchmarks currently run in GitHub's Linux Node environment, NOT iPhone Safari. These timings do not predict match FPS or battery impact.

[Phase 2 physics and limitations](docs/design/phase-2-ball-physics.md)

Live preview: https://sm75z697k8-droid.github.io/O11-Football-Manager/

Next work requires separate approval: meaningful player–ball contact and tactical decisions, leading to a real landscape-first 2D match viewer.
