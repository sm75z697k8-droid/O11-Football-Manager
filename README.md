## Phase 6.9I — Stable challenges and iPhone event handling

A real unsuccessful physical tackle (`heldOff`) now has to be **re-armed by a new approach** before the same defender can challenge the same ball controller again. Previously a defender who remained continuously inside foot reach could register the identical failed challenge every six 50ms ticks, driving up the PHYSICAL CONTACTS count while the ball carrier barely moved. The new logic retains the first attempted tackle, allows another defender to challenge, permits a fresh re-entry after separation, and does not invent touches, turnovers or goals.

When a **real failed tackle** leaves a defender crowding the ball carrier, the attacking AI now reconsiders pass/carry/shot options promptly based on that unresolved physical contest—not on another duplicate contact event. This compensates for removing the duplicate contact events that previously triggered incidental replanning; normal unpressured decision pacing is preserved. The iPhone match viewer now avoids re-cloning a large state twice on catch-up frames, formats only a bounded recent slice of contact events instead of sorting complete history on every HUD update, and stops the playback loop once a goal ends the exhibition. The authoritative event history and checkpoints remain intact. See [Phase 6.9I stability design](docs/design/phase-6-9i-contact-loop-stability.md).

## Phase 6.9H — Decision-making beyond the first pass

The on-ball AI now asks whether a physically reachable teammate can do something useful **after** reception. Within 36 metres of goal it performs a cheap, bounded, deterministic follow-up estimate of that receiver's shooting lane, ability to carry into space, or a plausible forward second pass. The result is weighed against opponent pressure, predicted receiver location, individual technical/mental attributes, existing pass safety and the carrier's alternative dribbles/shots. No generated outcome, possession, goal or save is awarded; the original engine still performs all actual actions and interceptions.

This affects **which** real pass a player selects, not how often passes automatically succeed. A safer sideways pass remains valid under pressure. The existing goalkeeper-handling, final-third winger runs, third-man movement and 2D contact physics are preserved. The match algorithm version advances while checkpoint schema v9 remains stable. See [Phase 6.9H technical notes](docs/design/phase-6-9h-receiver-continuation.md).

## Phase 6.9G — Third-man attacking combinations

When an actual ground pass is moving toward a teammate in the attacking third—or has just been physically controlled by that teammate—the remaining attackers can prepare the **next** attacking move. When a winger controls the ball near the opposing penalty area, an available same-side midfielder can also offer an **underlapping** route toward the centre if a real open lane exists. O11 now searches a small set of real, physically reachable lanes for **one** striker or central midfielder to make a third-man run. The support runner never steals the original receiver's ball engagement. Teammate separation, defender positions, a conservative approximation of the second-last defender, and real shot corridors determine whether the run is worthwhile. The recipient still needs to control the initial pass, turn, and deliberately choose the next pass or shot; the engine awards no scripted assists, passes, or saves.

This improvement keeps the 6.9F winger half-space behaviour, 6.9E goalkeeper handling, real physical passing, and deterministic checkpoints. See [Phase 6.9G design notes](docs/design/phase-6-9g-third-man-combinations.md).

## Phase 6.9F — Purposeful final-third attacking runs

The match AI now considers **inside-channel winger runs** when a teammate actually controls the ball in the attacking final third. Rather than leaving both wide forwards next to the touchline, the team may select a half-space target based on real defenders, shot corridor quality, available teammate separation, physical distance to the ball carrier and an approximate offside-aware position ceiling. These are only movement intentions: players still travel using the existing movement physics, passes still need actual ball contact, and the goalkeeper only reacts to genuine shots.

Wide players retain their wide outlets earlier in build-up; the change does not move the entire team into the box, force shots or generate fake saves. Our performance and seeded integration diagnostics continue to report actual shot kicks, goals, goalkeeper catches/parries and physical passing success. The deterministic match engine version is bumped while checkpoint schema remains v9. [Design and verification notes](docs/design/phase-6-9f-attacking-runs.md).

## Phase 6.9E — Goalkeeper hands, catches, parries, and deliberate release

Goalkeepers now respond to real opposition shots within their own penalty area using physical swept hand contact. Manageable shots produce a recorded **catch**, holding the ball at hand height rather than at the keeper's feet. More difficult shots that physically contact the gloves are **parried** and remain loose, with their actual ball velocity changed by the collision. A held ball cannot be foot-kicked instantly; after a short deliberate hold, a distinct physical hand-throw command can distribute toward a selected nearby teammate without guaranteeing possession. Goalkeepers also take longer to settle a genuine ball received at their feet before kicking it again. The current keeper distribution planner is basic and does not yet cover directional dives, sweeper-keeper roles, crosses, or sophisticated build-up play.

Automated tests exercise catch, parry, hand holding, delayed throw and replay checks; the match algorithm version was bumped while retaining serialized schema v9. See [Phase 6.9E design notes](docs/design/phase-6-9e-goalkeeper-handling.md).

## Phase 6.9D — Intelligent recovery handoff

O11 now reviews a **physically kicked pass** every 200 simulated milliseconds to determine whether the intended receiver still has the best realistic opportunity to recover it. A materially faster outfield teammate can take over once the ball deviates, while the previous receiver returns to support/shape. The team immediately replans the recovery roles rather than waiting the usual 0.6 seconds. The existing special opening kickoff receiver is preserved.

This is a bounded, deterministic tactical estimate. It does not move the ball artificially, award touches or promise that every poor pass will be recovered. The previous physically-receivable pass planner and shooting/contact rules are retained; schema v9 is unchanged, with a new deterministic engine algorithm version. See [Phase 6.9D design](docs/design/phase-6-9d-recovery-handoff.md).

## Phase 6.9B — Real passes to real teammates

O11 now rehearses each proposed pass using the **actual 50ms ball and receiver movement equations** before committing to the kick. The pass will only be considered when the nominated teammate has a plausible physical opportunity to reach it. Passes aim nearer the teammate's feet, account for braking/momentum, penalize unnecessary touchline danger and retain skill-/seed-dependent execution error. If the ball deviates far enough, the receiver updates toward the actual trajectory. Players also pause briefly after physical reception instead of endlessly releasing the ball on the very next tick.

The nine-seed headless fixture previously produced **79 / 104 (76%)** physically controlled passes by the intended receiver. After the physical rehearsal and release-pacing changes it produced **136 / 164 (83%)** in the same seeded benchmark. These are diagnostic simulation figures, not real football probabilities or a guarantee across other teams. The total attempted passes also fell in the benchmark, despite matches often lasting longer.

The actual match engine still decides every kick, first touch, interception and goal. Defenders remain able to intercept, and passes are not guaranteed. The deterministic seed and checkpoint schema v9 remain preserved, while the engine algorithm version changes. The known limitation of matches stopping at the first out-of-play/goal still applies.

See [Phase 6.9B technical notes](docs/design/phase-6-9b-pass-connection-reliability.md).

## Phase 6.9A — Intelligent On-Ball Anticipation

The autonomous 2D football AI now forecasts up to **1.6 simulated seconds** when considering passing, carrying or shooting. Passes are checked against moving defenders and anticipated receiver position (not just today's open-looking lane). Carry choices consider defenders arriving near the planned route, attacking progress and safe continuity rather than zigzagging across repeated decisions. Shots remain selected by credible chance and physically executed. A newly consolidated snapshot ensures the AI's kick-release selection and its movement instruction see the same world.

Select the **player currently on the ball** in the Player Inspector to see an **AI THINKING** diagnosis: expected action, reasons, and its three closest tactical alternatives. The forecast is a heuristic, not a simulated event or pass-completion probability. It is generated on demand, not for every Canvas frame.

Replay and New Match retain their Phase 6.8 seed behavior. No additional telemetry is persisted or sent over the internet. Deterministic checkpoint engine version is updated while the schema stays v9. The exhibition still stops at goals/out-of-play, with no real restarts, clock, referee, league management or a complete FM-quality tactical system.

See [Phase 6.9A on-ball planning notes](docs/design/phase-6-9a-short-horizon-football-decisions.md).

## Phase 6.8 — New Match versus exact Replay

The match viewer now offers separate **REPLAY** and **NEW MATCH** controls, including after a goal or out-of-play event. **REPLAY** uses exactly the current match seed and reproduces the same physical decisions and outcome for testing. **NEW MATCH** generates a different 32-bit seed with Web Crypto on the iPhone and starts a new exhibition with the same teams; the seed is visible on the viewer.

The AI's actual pass, carry and shoot judgments now have **tightly bounded deterministic seed-derived variation among genuinely close options**, moderated by Decisions, Composure and Vision. Strongly superior options retain priority. Kick-off may go to a different plausible midfielder when their abilities are close. These changes do not select winners, guarantee different scores, invent successful passes or alter real ball contact/goal-line physics.

The engine remains a 20Hz seeded simulation and can still replay byte-for-byte from checkpoints. The match-state schema remains v9; the engine version is bumped for deterministic compatibility. Different seeds can occasionally result in a similar or identical score. Official match clock, full restarts, refereeing, tactical adaptation and career mode remain unimplemented.

See [Phase 6.8 technical design](docs/design/phase-6-8-seeded-match-variation.md).

## Phase 6.7 — Attacking purpose, shots and real goal-line results

O11 now evaluates **carry, pass and shoot** using player attributes, space, shooting angle, line-of-sight and whether a pass produces a better chance than its alternatives. A shot is a real physics kick weighted toward Finishing; goalkeepers move to meet incoming shots and can make a physically swept interception or deflection. A score is recorded **only when the actual ball entirely crosses the goal line between the posts and below the bar**; real own goals are identified from the last toucher. No random xG roll creates a goal.

The match viewer now shows the actual score and a GOAL announcement. After a goal, the exhibition stops instead of faking a restart. Throw-ins, corners, goal kicks, official periods, comprehensive goalkeeping and full football rules are not implemented. These remains estimated, deterministic football heuristics rather than Football Manager-equivalent AI. Match/checkpoint schema v9 prevents old replay versions from silently mixing.

See [Phase 6.7 technical notes](docs/design/phase-6-7-attacking-and-goals.md).

## Phase 6.6 — Reactive loose-ball intelligence

After a misplaced pass or failed first touch, **last touch no longer counts as possession**. Players on both teams respond to a physical recovery race; the nearest viable challengers adjust toward the moving ball while teammates hold coordinated support/cover responsibilities. A new kick, deflection or interception triggers an immediate next-tick AI reassessment rather than up to 0.6 seconds of outdated instructions. Short passing combinations are permitted after 0.6 simulated seconds, still depending on actual defensive space, player attributes and physical kicking.

The existing full-screen 2D viewer, genuine opening kickoff, goalkeeper conservatism and previous defensive shape are preserved. No completed passes, interceptions or results are fabricated. This remains a limited deterministic utility system, **not Football Manager-level tactical intelligence**. Goals, shots, refereeing, offside and throw-ins/corners remain unfinished.

See [Phase 6.6 technical design](docs/design/phase-6-6-reactive-loose-balls.md).

## Phase 6.5 — Defensive team intelligence

**Updated defensive recovery for every outfield role.** Players no longer automatically mark the nearest opponent to an old formation anchor. Instead, the defending XI has a collective set of responsibilities: nearby pressers, one goal-side cover player, compact midfield and backline recovery, selective nearby marking of genuinely dangerous attacking opponents, and wingers staying on their team-relative sides. The goalkeeper stays near its goal.

This specifically addresses the user's iPhone observation that #8 would follow an irrelevant opposing defender instead of dropping to protect the home defence. High/standard/low pressing still alters commitment, while physical tackles and possession are resolved exclusively by the existing authoritative engine.

The attack planner, full-screen viewer, legal kick-off and fixed 50ms physics remain unchanged. The match schema stays v8, but deterministic replay engine version is updated to protect against mismatched AI algorithms.

See [Phase 6.5 design](docs/design/phase-6-5-defensive-team-intelligence.md). Goals, referee, shooting, offside, full match periods and out-of-play restarts are still not implemented. Heuristic positioning and pressing remain estimated simulation values; on-device visual tests are required.

## Phase 6.4 — Intelligent possession and spatial support

The on-ball AI now weighs **real open passing lanes, defenders' proximity and marked receiving players** more directly against carrying; it no longer has an unconditional large passing penalty. Teammates search nearby physically useful support space, while respecting home/away flank discipline, positional roles and distance from one another. The earliest permissible follow-up pass is now 1.2 simulated seconds rather than 1.8 seconds after the previous AI attempt.

These are **estimated deterministic football decisions**, not scripted passes or guaranteed outcomes. Actual acceleration, kicking, ball trajectory, possession and interception remain authoritative. The existing kickoff, full-screen 2D viewer, 50ms clock and defensive pressing implementation are unchanged.

See [Phase 6.4 design and testing](docs/design/phase-6-4-possession-and-support.md). The next separate system to refine should be coordinated defensive pressing, guided by actual iPhone observation. Rules, goals and restarts still aren't implemented.

## Phase 6.3.1 — Flank discipline and coordinated physical passes

The off-ball AI now keeps the **home and away teams' right/left roles on their correct flanks**, including the mirrored away kick-off midfielders. It no longer treats right as the same screen direction for both sides. Central midfielders can narrow but maintain their designated relative flank, and wide players preserve useful width.

When the possession AI selects a pass, the command is linked to an **explicit real teammate**. That intended receiver engages before the kick and updates their movement target each 50 ms physical tick as the actual ball travels, rather than blindly remaining in place or chasing an old pass coordinate. The temporary pass instruction expires when the ball is lost, a kick fails, or enough simulated time has elapsed. The existing physics continues to decide whether the kick and interception succeed.

Estimated pass power has been recalibrated against the actual contact-engine speed formula so nearby pass targets are not consistently struck with excessive force. All numbers remain uncalibrated game-design estimates, and through balls or lost passes can still legitimately miss.

Match state and checkpoint schema is now **v8**, because an explicit transient `ai.passIntent` is persisted and validated against real queued/applied physical commands. Previous v7 snapshots are rejected rather than misinterpreted. The existing full-screen viewer, 50ms physics, opening kick-off and non-AI diagnostic behavior are preserved.

**Still not implemented:** full-body player collisions, keeper intelligence, goal adjudication, referee, throw-ins, corners, shots and restart logic. The viewer will still pause once the ball truly leaves play.

See [Phase 6.3.1 design and tests](docs/design/phase-6-3-1-flank-pass-coordination.md).

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
