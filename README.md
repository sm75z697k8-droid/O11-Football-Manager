# O11-Football-Manager

A simulation-first football management game in development, designed for full-screen **landscape-first play** on iPhone Safari and desktop. The current deployed page is a **temporary development preview**, not the finished interface.

## Current status: Phase 0E

- React + TypeScript + Vite foundation with GitHub Pages.
- Canonical two-team fictional fixture: **Harbor Athletic vs Vale Rovers**, 11 players per side.
- 49 core numeric attributes, 11 hidden characteristics and validated fixture data.
- Deterministic fixed-step clock, independent seeded RNG streams, match foundation state and ordered command receipts.
- Complete JSON checkpoint/restore. Tactics settings currently store intent **without affecting player movement**.
- Regression, static performance baseline and production/deployment smoke checks.

**Not yet implemented:** actual match play, dynamic positioning, ball physics, attacking/defending AI, scores, playable match viewer, career gameplay or save management. Static fixture positions are not a simulated match.

## Development and verification

All development is possible with GitHub's mobile website/editor and GitHub Actions; no Mac or PC is required.

The Actions tab runs CI (TypeScript, tests, build and local asset verification). A successful CI push starts the GitHub Pages deployment, which verifies HTTP availability of compiled JavaScript and CSS.

Local commands (GitHub Actions runs them automatically):

```sh
npm ci
npm run check
npm run benchmark:foundation
```

`benchmark:foundation` measures **only static foundation diagnostics on Node**, not real football simulation or iPhone FPS. See [Phase 0E verification notes](docs/design/phase-0e.md).

GitHub Pages must use **Settings → Pages → Build and deployment → Source: GitHub Actions**. We previously fixed a blank screen caused by using branch publishing instead of the compiled Vite build.

Site: https://sm75z697k8-droid.github.io/O11-Football-Manager/

Next: deterministic physical player movement, subject to separate approval. The match viewer will render the same authoritative state the engine actually simulates.
