# O11 Football Manager

A serious simulation-first football management game, built to become a **full-screen landscape-first game** on iPhone Safari and desktop. Development uses GitHub's web editor and GitHub Actions, so no Mac or PC is required.

## Current stage: Phase 3 — player–ball interactions

- Exactly two fictional test teams: **Harbor Athletic** and **Vale Rovers** (11 players each).
- Canonical football data; fixed 50 ms ticks; seeded reproducible randomness; authoritative player, ball and command state.
- Deterministic player movement: acceleration, braking, turning, physical limits and pitch boundaries.
- Deterministic free-ball physics: rolling resistance, gravity, approximate air resistance, turf rebounds and ball boundary detection.
- **Player-ball interaction:** explicit first-touch requests and kick attempts succeed only when the player is physically close enough to the ball, its height allows foot contact, and the ball is available. First-touch skill and ball speed affect control; passing/technique/strength affect a released kick. Outcome events and RNG streams are checkpointed.
- Controlled-ball offset is an early constrained-control approximation, **not complete dribbling**.
- Complete versioned checkpoints, replay tests, and production/deployment verification.

### What this is not yet

The displayed website remains a **temporary development preview**, not a rendered live match. The match engine has no autonomous tactical AI, automatic player-ball collision, match rules, goals, score changes, goalkeeper handling, interactive 2D viewer, career mode or persistent saves. Diagnostic commands are manually issued for physics tests; they do not represent simulated tactical passes or shooting choices.

## Development checks

GitHub Actions runs TypeScript checks, Vitest, the compiled Vite build and verifies that GitHub Pages serves HTML, JS and CSS correctly.

- `npm run check`: full CI-equivalent check.
- `npm run benchmark:foundation`: static logical-tick baseline.
- `npm run benchmark:motion`: commanded player locomotion baseline.
- `npm run benchmark:ball`: free-ball physics baseline.
- `npm run benchmark:contact`: two player-ball contact attempts and physics baseline.

All benchmark figures are from **GitHub Actions Linux Node**, *not iPhone Safari*. They are not full match FPS figures.

GitHub Pages must remain set to **Settings → Pages → Build and deployment → Source: GitHub Actions**. The deployment check prevents repeating the previous white-screen publishing error.

[Phase 3 physics, limitations and testing](docs/design/phase-3-player-ball-contact.md)

Preview: https://sm75z697k8-droid.github.io/O11-Football-Manager/

The future match viewer will visualize this **same physical simulation**, not separate cosmetic football animations. Subsequent stages need independent approval.
