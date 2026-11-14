# PRS-S1.1 — Coordinated wide pressing traps

## Scope and baseline

A refinement of the existing 6.9O / DEF-F1 defensive planners, **not** a second
physics engine. Previously a wide carrier could trigger a nearest eligible
primary presser and optional second high-intensity presser, but players left
behind were predominantly assigned generic cover, marking and recovery targets.
They did not deliberately screen a physical carrier-to-outlet passing lane.

This phase addresses **one tactical problem**: the opposition controls the ball
near a touchline, and a defending team has enough nearby bodies to close from
inside while screening a plausible central escape pass.

## Algorithm

The pure `planWidePressingTrap` planner operates on the same authoritative
world snapshot and the same team-specific 0.6-second decision cycle as the rest
of O11:

1. Require a real opposition controller, ball within 9m of a touchline,
   a previously eligible primary presser within 10m (standard) or 14m (high),
   and intensity above `low`.
2. Inspect **real opponents** for a projected nearby inside outlet
   (7–30m from the current ball, at least 6m more central than the carrier;
   no speculative receiver creation or far-away dummy lanes).
3. Match one available outfield screener with a point on the true
   ball-to-outlet segment (35–78% along). The target must be within
   9m/12m of the defender's current position and within 8m/10m of the
   established defensive recovery block (standard/high respectively).
4. Prefer credible central access, goalward threats, skilled readers of
   play, role fit, attainable movement and consistent previous marking.
5. Give the existing first presser an angled goal-side, inside-out approach
   if farther than 3.5m from the ball. At near-foot range the target becomes
   the **actual** physical ball as before. The original separate cover
   defender remains assigned; the new screener cannot replace them.
6. If no feasible combination exists, return `null` and retain the old
   pressing, cover and individual-defence fallback, without synthetic events.

The action is represented with the existing `mark` / `press` assignment
types to preserve checkpoint structure and contact integration. An AI target
never grants an interception, tackle, foul or possession: only 50ms physical
movement and existing swept contact can produce those events.

## Boundaries and limitations

- The 4-3-3 formation and low/standard/high pressing intensity interfaces
  remain unchanged. The low setting does not organise wide pressing traps.
- Only the first presser adjusts its approach, and only when a viable separate
  lane screen exists. No scripted curved animation or teleport is introduced.
- The other nominated high-intensity presser remains subject to the old
  legitimate double-press rules; this phase does not overhaul that selection.
- The defensive model does **not** yet choose between all possible sequences
  of future passes, learn opponent patterns or simulate accumulated fatigue.
- Selection geometry and weights are estimated simulation heuristics,
  not calibrated professional tracking statistics.
- The new planner is bounded by the 22-player snapshot and invoked only
  during normal decision scheduling, never as a per-50ms physics scan.
- The match engine identity changes so older saved deterministic trajectories
  cannot be silently treated as the same simulation.

## Verification

Added `tests/unit/s11-wide-pressing-traps.test.ts` for:
- Mirrored home/away wide possession and a real central outlet.
- Separate designated primary presser, defender screening the literal
  carrier-to-outlet segment, and retained cover role.
- Decision integration and non-teleporting movement.
- No fabricated screen when there is no inside outlet.
- No extreme recovery run if a would-be screener is unreachable.
- Normal fallback when the carrier is central.

Existing intensity, 6.9O pressing, DEF-F1 defensive marking, goalkeeper,
contact, offside and restart tests must remain passing.

CI command: `npm run check`. The PR workflow runs TypeScript, Vitest and
production build. Browser-level motion and the feel of defensive behaviour
must still be checked on iPhone Safari.

## iPhone acceptance

When deployed, check **BUILD PRS-S1.1** in the match viewer. Watch for a
wide receiver under close pressure: a separate player should sometimes
position on the obvious inside pass instead of charging the carrier.
The team should also decline an organised trap when the outlet is absent
or the defensive unit is too far away. A good screen may or may not win
possession, as it requires real ball flight and contact.

If it looks unnatural, capture the match seed, tick and pressing intensity.
This phase does not attempt to fix unrelated touchline restart deadlocks.
