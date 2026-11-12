## Phase 6.3 — Coordinated team intelligence

O11 now computes **predictive pass reception** from the actual moving ball and each player's physical reach, rather than always chasing the current ball position. The opening kick has two nearby central-midfield options and chooses an intended recipient by relevant attributes. The other ten players act on coordinated responsibilities: staggered passing-triangle support, wing width, holding-midfielder outlets, goal-side defensive cover and selective marking alongside realistic pressing.

This is **estimated, deterministic off-ball AI**, not learned tactical intelligence or scripted completed passes. Ball contacts, tackles, kicks and velocities are still resolved by the authoritative physics. The full-screen iPhone landscape view is unchanged; football rules, scoring and out-of-play restarts are not yet implemented.

See [Phase 6.3 technical design](docs/design/phase-6-3-team-coordination.md).

## Phase 6.2 — Context-aware football AI

The ball carrier now evaluates genuine **passing lanes, nearby pressure, safe space and boundary risk** rather than always running toward goal. Forward, sideways and backward passes can be selected when preferable; otherwise players choose an open carry direction through existing movement physics. Attributes influence the decisions, and kicks are still executed through real ball/contact physics, never awarded automatically.

This is a **deterministic estimated utility planner**, not machine learning or Football Manager-level tactical intelligence. The opening kick-off and full-screen match viewer are preserved. Goals, shooting and out-of-play restarts are still **not** implemented. Engine behavior changed, so the engine-version string was bumped even though state schema v7 remains the same.

See [Phase 6.2 decision architecture](docs/design/phase-6-context-aware-ai.md).

## Phase 6 — Physical opening kick-off correction

The two fictional teams now start the *viewer fixture* in their own halves. The opposing team stays at least 9.15m from the centre ball, which is stationary before kick-off. Pressing Play executes an actual short pass toward a supporting midfielder through the same physical kick/contact system used elsewhere. The AI waits for that physical kick and ball movement before chasing, and the designated receiver—not the kicker—pursues the opening ball.

This uses an opt-in fixture flag; existing physics test fixtures remain unchanged. Checkpoints are now version 7 to validate real kick-off chronology.

**Still outstanding:** general match restarts, scorekeeping, official game periods and intelligent possession decisions. This opening correction does not hide those limitations.

See [kick-off architecture](docs/design/phase-6-opening-kickoff.md).

# O11 Football Manager

A simulation-first football management game designed for **landscape-first full-screen iPhone Safari and desktop**, developed entirely using GitHub web editing and GitHub Actions.

## iPhone viewer refinement — full-screen field

The UI now uses a **full-viewport Canvas**, a small floating fixture strip and a compact transport controller instead of reserving permanent space for a statistics sidebar, tall header or footer. Tap a player for a transient details card; use the top-right buttons for a dismissible player inspector and genuine physics event log. The pitch remains geometrically correct, with an original stadium-style surrounding illustration.

The AI/out-of-play limitation is **not yet fixed**: once the physical ball leaves the field, the viewer pauses and shows an honest warning plus Reset. It does not fabricate a goal, corner or throw-in. Rules and restarts are a separate next milestone.

See [immersive pitch layout notes](docs/design/phase-6-immersive-layout-refinement.md).

## Phase 6 — Real 2D physics viewer

The deployed application now opens a full-height, landscape-first football **match lab** that draws real states from the authoritative simulation engine. It is no longer a static illustrative preview.

The 2 fictional teams are **Harbor Athletic** and **Vale Rovers**, with 11 players each. Both existing autonomous AIs are enabled using real match commands once the simulation starts. The viewer renders actual player movement, the ball's physical trajectory and height, real possession, the selected player's target, and physical contact history.

Controls include **Play/Pause, Step (one real 50ms tick), 1×/2×/4× playback, Reset**, and selecting a footballer by tapping a marker or using the inspector. The canvas uses aspect-correct metric coordinates and capped Retina pixel density for performance.

**Important:** This is still **not** a complete competitive match. There is no goal adjudication, official score, referee, full 90-minute game clock, restarts, offside, goalkeeper strategy, transfers or a saved career. The UI explicitly shows **— : —** and labels the elapsed time as a diagnostic simulation, to avoid misrepresenting physics testing as an official football match. The ball can leave the pitch without a restart until actual match rules are implemented.

## Architecture

- `src/game`: pure models, deterministic simulation, physics, autonomy and the new physics viewer.
- `src/data/fixtures`: canonical fictional test setup used by both the app and existing regression tests.
- `src/app`: React application shell and responsive game UI.
- `tests/viewer`: projection, fixed-step pacing, reset and authoritative-data tests.

See [Phase 6 design and limits](docs/design/phase-6-match-viewer.md).

## Verify on iPhone

Open https://sm75z697k8-droid.github.io/O11-Football-Manager/ in Safari. Rotate the phone to **landscape** (disable iOS Portrait Orientation Lock if it prevents rotation). Press PLAY to watch computed player and ball movement. Select a player and test 1×/2×/4× speeds, pause, STEP and RESET.

The app cannot reliably force iPhone Safari into landscape orientation automatically. For a more immersive full-screen experience, later PWA installation support can be added, but is not part of this release.

## GitHub Actions

Keep **Settings → Pages → Source: GitHub Actions**. CI runs `npm run check` (TypeScript, all tests, Vite build and compiled-asset verification). A successful run deploys Pages and checks published JavaScript/CSS HTTP responses.

Node-only benchmark numbers are **not** iPhone Safari FPS or long-term match performance measurements. Existing commands/simulation/checkpoint functionality remains intact.

Later phases will implement referee/rules and improve behavior using observations from this authentic viewer.
