# O11 — Phase 3: Player–ball contact and kicking

## Scope implemented

This release connects the *same* deterministic 22-player authoritative model and free-ball physics used in Phases 1–2. Only Harbor Athletic and Vale Rovers exist in the test fixture.

- **Physically gated foot reach:** A first touch or kick can happen only when the real player and ball are within a 1.05 m planar reach, the ball centre is no higher than 0.45 m, and the ball has not fully left the pitch.
- **First-touch calculation:** Relative horizontal ball/player speed, ball vertical speed, contact distance and height influence difficulty; technical first touch and technique, physical balance, and mental composure influence control quality. A *small* seeded variation influences the margin. A difficult touch can physically deflect the ball instead of inventing possession.
- **Controlled ball state:** Successful control records the real player ID and a short relative offset. The ball follows the player's calculated physical position and velocity while controlled. This is an initial local-control constraint, **not a genuine dribbling engine**.
- **Player-originated kick:** A kick requires the same physical reach and has an actual target, power and loft input. Its outgoing ball impulse is based on passing, technique, composure and physical strength; angular error also reflects skill and player facing. No fake shot or match-result event is generated.
- **Ordered diagnostic commands:** `attemptFirstTouch` and `attemptKick` are accepted/rejected by the normal command queue, but a queued request is not a successful touch. The command's eventual outcome is stored as a `ContactEvent` (controlled, miscontrolled, kicked, outOfReach, occupied, alreadyControlled or invalidDirection).
- **Deterministic replay:** Eligible actions consume one draw from the existing named `ball/contact` seeded stream. Unreachable actions consume none. Events, controller state, the complete RNG stream and physical ball state are saved; checkpoints can restore mid-control and after a kick.
- **Preserved prior behavior:** External diagnostic ball launches still work and now correctly clear controller/last-touch claims. Physical movement, ball gravity/bounce, tactical-preference commands and all fixture validations remain.

## Simulation parameters (estimates, not verified biomechanical measurements)

| Parameter | Initial estimate |
|---|---:|
| Planar foot reach | 1.05 m |
| Maximum ball centre height for foot touch | 0.45 m |
| First-touch weighted attributes | 40% first touch, 25% technique, 20% balance, 15% composure |
| Control difficulty | Relative speed + ball height + contact distance |
| Execution variation | Approximately ±6 rating points, deterministic seed |
| Kick precision weights | 50% passing, 30% technique, 20% composure |
| Outgoing velocity | Power, strength, technique, skill and launch loft |

These formulas require later validation with real observed football trajectories and touches. Attribute ratings are not literal probabilities, and geometry matters regardless of seeded variance.

## Critical limitations

**Explicit diagnostic attempts only.** There is no tactical AI to choose who receives, intercepts, shoots or passes. The engine does **not** automatically assign a touch to an arbitrary nearby player. Commands must be deliberately issued, then their real geometry is evaluated at the execution tick. An uncommanded striker stays in formation, even if the ball rolls nearby.

No swept player–ball continuous collision test yet (high-speed balls may cross reach between 50 ms ticks). No actual player body or foot mesh, tackle contest, stamina depletion, dribbling cycles, goalkeeping hand control, heading, fouls, rules of football, offside, match clock, scoring, 2D match visualization or league/career AI. Opponents currently cannot dispossess a controlled player automatically.

The relative control tether is a deliberately simplified model of close foot control, **not a credible finished dribbling animation or physical ball collision**. We will refine it before presenting it as complete football gameplay.

## Versioning and testing

Match state and checkpoints are explicitly version **4**. Older Phase 0D, Phase 1 and Phase 2 checkpoint snapshots are rejected, not silently migrated. There are no user career saves to preserve yet.

GitHub Actions runs all TypeScript, Vitest, production build and GitHub Pages published JS/CSS checks. New integration tests validate physical reach, high or fast balls, skill effects, ownership, first touch, kicking, queued versus actual outcomes, deterministic RNG, complete checkpoints and fraudulent state rejection.

Node performance measurements are **not** iPhone Safari performance or FPS. A full-screen, landscape-first 2D viewer will eventually consume *this same authoritative state* and must not animate fabricated passes or goals.

**Next milestone requires separate approval.** The immediate valuable improvement after Phase 3 is automatic physical ball proximity/contact resolution and opponent contest mechanics, or beginning controlled tactical decision-making. We should evaluate actual movement and possession quality before full UI.
