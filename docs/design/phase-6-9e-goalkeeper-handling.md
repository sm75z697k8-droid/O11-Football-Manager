# Phase 6.9E — Goalkeeper handling, clean catches, parries, and deliberate release

## Why this improvement exists
Previously the match engine let a goalkeeper stop an opposition shot using an outfield-style automatic interception. A successful save immediately attached the ball to the keeper at foot height; the usual autonomous kick selection then allowed an unrealistically quick pass. The simulation had no concept of a secured catch in the keeper's hands.

## Authoritative physical implementation
- Only an actual moving opposition shot in the keeper's own penalty area can activate the special gloved reach envelope. An intersection with the shot must occur in swept player-ball physics. It is **not** a save animation.
- A manageable contacted shot becomes a real `caught` automatic-contact event when reflexes/handling/positioning, relative velocity and contact distance satisfy a stricter threshold. The ball is held at a bounded, body-relative **1.12 metre hand height**, moving with the keeper rather than turning into an ordinary foot-level controlled ball.
- Otherwise the physical contact is `parried`: the resulting change in velocity is the existing authoritative deflection impulse, with the goalkeeper recorded as last toucher. A shot can still beat a keeper who never reaches the ball.
- While the ball is held, ordinary foot kicks and outfield release decisions cannot occur. A real catch event is the source of the holding state; checkpoint validation reconstructs catch and throw chronology from the same physical event logs.
- To prevent a goalkeeper holding the ball indefinitely in this early exhibition, a basic nearby-outlet planner schedules a **distinct `attemptGoalkeeperThrow` command** only after 2.45–3.1 simulated seconds. It selects a nominal teammate using pressure and distance, and the hand release begins at hand height with skill-dependent deterministic angular variation and real 50ms airborne ball physics. Neither the throw nor the first touch is guaranteed.
- The designated receiving teammate uses existing pass-intent coordination; other players retain current pressing/support systems.

## Compatibility and limitations
- Serialized keys and checkpoint schema remain v9; accepted contact event kinds/outcomes are extended, so the deterministic engine algorithm version changes and old checkpoints are deliberately incompatible.
- This is **not** a full goalkeeper AI: no directional dives, frame-by-frame arm/body collisions, tactical sweeper-keeper decisions, legal handback rules, catchable crosses, punching, advanced throwing styles, or goalkeeper possession countdown enforcement.
- Physical constants/thresholds are estimated simulation values. A keeper's hands are represented by a bounded contact/reach radius, not skeletal collision meshes.
- Automated testing covers nominal catches, high-speed parries, secure hold, early invalid throw attempts, actual later throws, replay safety and regression checks. iPhone Safari observation remains necessary.

