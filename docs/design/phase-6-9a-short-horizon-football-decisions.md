# Phase 6.9A — Short-Horizon On-Ball Football Decisions

## User problem

The user confirmed that separate new and replay seeds work, but still noticed that the players' football decisions need significant improvement. Previous live behavior was driven mainly by static snapshots: open receivers earned immediate utility even when running away from the intended kick, and defenders closing passing lanes were not forecast. Carries could change direction from one decision to the next. The team planner then recalculated the release after writing new intentions, potentially producing inconsistent advice.

## Bounded, explainable 1.6-second planning

`src/game/ai/short-horizon.ts` evaluates only the options already produced by the existing contextual pass, carry and shoot planner, which tops out at 8 carry directions, 10 possible teammate recipients and 1 shot. It never simulates a second match, spawns events, moves a real player, awards possession or chooses a result.

It estimates the ball's travel time toward a pass recipient from the **same physical kick power calculation** used by the existing engine. It predicts nearby player movement from present position, velocity and already assigned intention (bounded by actual speed attributes and pitch edges). Three fixed samples along a pass estimate interception congestion. Reception penalties reflect whether the intended teammate can reasonably meet the pass point and whether defenders will close down the first touch. Progressive passes gain a small reward only if the receiver's predicted position improves goal access.

For carries, the planner evaluates space over a short future route, considers where defenders may be when the carrier reaches it, rewards genuinely available forward territory, and applies a modest continuation bonus to maintain an earlier sensible run. A high-pressure defender or substantially better passing/shooting alternative still overrides that inertia. Shots receive additional moving-defender corridor checks; **no probability roll can turn a planned shot into a goal**.

### Physical integration and consistency

`src/game/ai/possession.ts` exposes a pure `evaluateOnBallPlan` reporting the expected action, forecast utility and concise reasons; the established pure best-current-state `evaluateOnBallChoice(..., seededVariation=false)` remains available to existing diagnostics and tests. Live autonomous decisions use the new forecast **before** the same bounded, seed-derived variation among closely ranked options introduced in Phase 6.8. Player Decisions, Composure and Vision still affect uncertain judgment, and clearly superior scoring options remain preferred.

`src/game/ai/runner.ts` now evaluates physical kick release and team movement from the **same unmodified physical snapshot**. Previously movement plans were written before the kick-choice calculation, which could alter the evaluated situation without a physical event.

The on-demand **AI THINKING** panel in the existing landscape player inspector shows forecast action, plausible tactical reasons, approximate review horizon and a maximum of the top three alternatives. It is only computed when the inspected player currently controls the ball, not in every Canvas frame, and is clearly labelled an estimate—not a guaranteed next event.

### Verification

Unit tests cover forecast determinism and immutability, opponent approach toward passing lanes, intended receivers moving away from the ball, meaningful physical momentum, bounded run continuity, shot selection in front of an open goal, option budget limits and match replay/checkpoint fidelity. CI additionally checks the older kickoff, pressing, legal physics, goals, seed variation, 22-player fixture, production build and GitHub Pages delivery.

### Limits

- This is **not** Football Manager's proprietary engine or an imitation of its full tactics. The prediction is a computationally cheap approximation, not a 1.6-second authoritative physics rollout. Real turns, acceleration, bounces, physical contacts, failed receptions and goals remain unpredictable from the AI forecast.
- The score weights and reaction constants are **uncalibrated simulation estimates**, not learned professional data or empirical pass-completion probabilities.
- This update does not implement coordinated off-ball scouting, player tactics instructions, reliable offside, fouls, professional goalkeeper technique or real set pieces.
- As before, goals and any out-of-play ball stop the exhibition, so many naturally seeded matches finish before shots. Full throw-ins, goal kicks and corners are a separate necessary step before meaningful long-match statistical calibration.
- No persisted AI-review fields are added; schema/checkpoint format remains version 9. The engine **algorithm version string changes** to prevent mixing checkpoints from incompatible AI code.
- Only the live iPhone test can establish visual quality and performance in iOS Safari. Node CI is not an FPS benchmark.
