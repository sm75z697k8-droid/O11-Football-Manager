# O11 — Phase 0E: foundation verification and release baseline

Phase 0E strengthens diagnostics **without adding match physics or game UI**. Harbor Athletic and Vale Rovers remain the only fictional 11v11 participants, used by one shared authoritative foundation state.

## Automated coverage

- `tests/regression/foundation-regression.test.ts`: identical serialized match checkpoints at deterministic tick boundaries, queued/applied command restoration, rejected tampered saves, fixture identity, separate seeded random streams, alternative valid pitch dimensions.
- `tests/performance/foundation-baseline.test.ts`: logs the duration of 108,000 STATIC logical steps, two-team initialization, checkpoint serialization/restoration, checkpoint byte count and heap delta.
- `scripts/verify-build.mjs`: ensures Vite's production HTML references actual nonempty compiled JavaScript/CSS under the correct GitHub Pages repository base, not `/src/main.tsx`.
- `scripts/verify-pages.mjs`: after deployment, checks HTTP 200 and content type for the compiled JS and CSS bundles and that the live HTML references the built assets. This directly targets the previously experienced blank-screen deployment issue.
- GitHub Actions executes typecheck, all tests, the Vite build, local asset smoke checks and the deployed-asset HTTP checks.

## Interpretation of performance measurements

108,000 logical steps equals 90 simulated minutes at our **provisional** 20 Hz engine timestep, but the engine still has **no gameplay clock, player decisions, movement, possession, ball physics or goals**. This workload is a deliberately inexpensive static diagnostic baseline on a Linux Node runner. It cannot predict iPhone Safari FPS, CPU load, worker behavior, battery consumption or performance after physics and AI arrive.

Do **not** turn these measurements into user-facing match performance claims, enforce arbitrary speed thresholds in CI or invent physics performance figures. Re-run measurable benchmarks after each physical simulation milestone and eventually on iPhone Safari itself.

## Acceptance and limitations

1. Regressions: all Vitest tests pass; JSON checkpoints restore and continue identically within the tested runtime.
2. Build: TypeScript and Vite build pass; locally generated assets have correct repository-relative references and exist.
3. Deployment: Pages uses GitHub Actions source and the live HTML, JS, CSS pass HTTP checks.
4. iPhone Safari: manually verify opening the published preview, no blank screen, orientation, basic visibility and interaction. GitHub CI cannot claim that Safari itself was tested.
5. UI remains a temporary website-style developer preview. Final O11 will be landscape-first full-screen and the Canvas renderer will visualize the **real engine state**, never fake player paths.

## Next implementation

Phase 1 should begin with deterministic player movement and bounded, physically plausible acceleration/turning, using the established match state. This is distinct from Phase 0E and requires approval. No AI-controlled actual football match is ready yet.
