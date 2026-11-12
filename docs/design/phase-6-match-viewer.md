# O11 — Phase 6: Genuine 2D physics viewer

## Milestone

The previous website-like development preview is replaced with a **landscape-first full-screen match lab**. Unlike the static schematic, it draws **the authoritative engine's actual 22 player coordinates, selected player's movement targets, ball position/height, physical ball owner and contact outcomes**. No separate animation engine generates events or movements. The two fictional teams remain Harbor Athletic and Vale Rovers.

## Modules

- `src/data/fixtures/fictional-match.ts`: production-side canonical fictional fixture, imported by the viewer controller. `tests/fixtures/fictional-match.ts` is now a compatibility re-export, so physics and AI regression tests use the identical fixture.
- `src/game/viewer/session.ts`: wrapper around the existing `createFoundationMatch` authoritative engine. Queues valid `setAutonomousTeam` commands for both fictional clubs at startup, keeps real adjacent tick snapshots, supports bounded step advancement, rebuilds a fresh seeded session for reset. No save logic is altered.
- `src/game/viewer/pacing.ts`: pure accumulator maps wall-clock intervals into integer engine ticks; speeds 1×, 2× and 4× alter pacing, not the 50 ms physics timestep. Catches at most eight ticks per render frame; stalls discard excess debt rather than causing unbounded work and freezing iPhone Safari.
- `src/game/viewer/geometry.ts`: maps metre-based pitch and players into CSS pixels using a letterboxed and aspect-correct projection, with consistent tap hit-testing and interpolation of **two actual engine state snapshots**.
- `src/game/viewer/renderer.ts`: pure Canvas 2D drawing that preserves actual field dimensions, penalty/goal areas, ball elevation cue, jersey numbers, team colors, controller outline, selection target and realistic state interpolation. Uses one canvas and avoids per-player React DOM updates.
- `src/app/App.tsx` + `App.css`: full-height game UI with teams, diagnostic time, genuine physical contact log, selectable player details, play/pause, one-tick STEP, speed and RESET. The viewport and display backbuffer are resized with ResizeObserver and capped to prevent excessive Retina pixel costs.

## Important design decisions

The browser experience is now a **real 2D visualization**, but NOT a competitive playable football match. No official match clock, score or goal is shown. The top fixture uses **— : —** instead of fraudulent 0–0 results; the diagnostic timer is explicitly labeled as simulation time. The user can watch meaningful physical events, but not manage transfers or play a league match yet.

Safari generally cannot be forced into landscape orientation from a normal website. In portrait on a phone, a rotate-device overlay guides the user; rotating the device reveals the full landscape screen. Controls are touch-sized and adjust to short landscape viewports. The session starts paused for battery and orientation comfort. The animation stops on tab visibility change. Future fullscreen PWA behavior, browser chrome removal and true device Safari profiling require further work.

The app uses real event counts and physical possession state, not fake percentages, invented commentary, decorative replays or predetermined results. The ball may leave the pitch and remain out of play because the rules/restart engine has not been built.

## Performance and correctness

Rendering uses capped device pixel ratio (max 2 and 2048 × 1400 framebuffer), one Canvas 2D context, a native animation-frame loop and throttled React heads-up updates (~7 Hz). Physics remains 20 fixed ticks per logical second; 2× and 4× schedule faster logical ticks without changing their numerical stability. Very long frames are capped to protect mobile browsers. Excess catch-up is intentionally dropped, so wall-clock simulation progress can slow on weak devices rather than locking up.

Phase 6 adds Node-only unit tests for projection, hit-testing, interpolation, pacing and the viewer's real engine integration, including bounded ticks, reset/reproducibility and no altered score. The existing full 135-test baseline also runs in GitHub Actions. CI checks TypeScript, Vitest and the Vite asset build; the Pages workflow verifies live compiled JS/CSS responses. **CI does not prove iPhone Safari rendering or interactive performance**: the user tests that on their phone.

## Not yet implemented

- Official match time/rules, referee, goal logic, offside, player collisions, keeper AI, set pieces, injury/fatigue, deep tactical decision-making or persistent career systems.
- Browser-based interactive tactical instructions, saved match recording, game progression or multi-league AI clubs.
- Actual scores; no goal or restart events are fabricated.
- Frame-rate telemetry/optimization on iPhone hardware. These require a separate device-testing iteration.

Next improvement should be driven by user observation of real 2D match movement, especially spatial overlap and poor decisions. Keep the modular physics/AI/UI boundary intact.
