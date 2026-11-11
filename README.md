# O11-Football-Manager

A serious football management simulator in development, designed as a **full-screen landscape-first game** on iPhone Safari and desktop. The published page is still a **temporary developer preview**.

## Current status — Phase 1: physical player movement

- React + TypeScript + Vite foundation and hardened GitHub Pages deployment.
- Exactly two fictional test clubs — **Harbor Athletic** and **Vale Rovers**, 11 players each.
- Canonical football data, deterministic clock, seeded random streams, command scheduling and versioned checkpoints.
- **Individual player locomotion is now functional in the headless engine**: explicit movement targets drive bounded acceleration, braking, turning, speed caps and pitch-boundary handling, affected by core physical attributes.
- Movement preserves deterministic continuation across tick chunk sizes and mid-stride saves; 66+ automated tests (verify current Actions logs for exact count).
- Regression, build asset smoke checks, deployed HTTP asset checks and informative Node motion profiling.

**Not yet implemented:** full football match, tactical player AI, live match viewer, ball physics, player collisions, dribbling, goalkeeping, possessions, scores, match clock, manager career and persistence. The screenshot-style visual pitch on the developer page is illustrative, NOT generated from the movement engine.

The match `period` stays `notStarted`. No fictional goals or invented football events are generated.

## Development and testing

You can maintain this project with only an iPhone, GitHub web editor and GitHub Actions.

The Actions CI workflow runs `npm ci`, TypeScript checks, all Vitest tests and the Vite production build. The compiled site asset check verifies that the JavaScript and CSS files exist. The Pages deployment verifies that the source is **GitHub Actions**, and that the live HTML, JavaScript and CSS are accessible.

```sh
npm ci
npm run check
npm run benchmark:foundation
npm run benchmark:motion
```

**Performance numbers from GitHub's Node runner are not iPhone Safari performance results.** The motion workload is not a full match.

GitHub Pages must use **Settings → Pages → Source: GitHub Actions** to avoid publishing uncompiled source.

Site: https://sm75z697k8-droid.github.io/O11-Football-Manager/

Architecture and limitations: [Phase 1 player movement notes](docs/design/phase-1-player-movement.md).

Next: carefully integrate additional real match physics and agent decisions. A future Canvas 2D viewer must visualize the *same* authoritative match state, not cosmetic animation.
