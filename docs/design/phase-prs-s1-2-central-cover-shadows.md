# PRS-S1.2 — Central cover shadows and realistic pressing handoffs

## Purpose

S1.1 adds actual touchline passing-lane screens. It does **not** establish
intelligent CENTRAL pressing angles: a central defender generally converges
on the carrier's ball/goal-side point even with a dangerous forward outlet.
S1.2 adds a bounded central tactical layer to the existing same-world,
same-time defensive decision snapshot and does not alter the physical match
engine.

This is a **distinct pressing milestone** from the historical S1.2 match
goal-kick restart phase. The new UI label is `BUILD PRS-S1.2`.

## Decisions, not scripted events

During an actual opposition-controlled central possession, the planner:

1. Requires a previously eligible primary presser, retained defensive cover
   within 19m (standard) / 23m (high), ball at least 16m from both
   touchlines, and ball at least 23m from the defender's own goal line.
   Low pressing retains its conservative legacy approach.
2. Evaluates real visible opposition receivers 7–30m from the carrier,
   advancing 5–29m toward goal, within 19m sideways. It projects current
   receiver velocity for at most 0.35s, never future passes or hidden intent.
   The top forward central outlet gets a higher chance of being denied.
3. Steers the already designated first presser toward a goal-side point
   near the carrier-to-outlet ray. Presser anticipation, decisions and
   defensive positioning determine the balance between this cover shadow
   and the existing straightforward goal-side closing run. Actual near-foot
   engagement still targets the **ball**, never a fabricated tackle.
   A jockey holds a physically reachable position without initiating a
   tackle.
4. May designate **one other defender** to screen a **different** forward
   passing lane. They must be within 10m (standard) / 13m (high) of
   the interception point and within 11m/14m of their defensive recovery
   position. Lanes that are nearly collinear with the first presser's
   covered route do not recruit redundant bodies. Midfielders are favored,
   centre-backs and the separate cover player cannot be redeployed.
5. Preserves the ordinary 1–2 direct ball presser cap, separate cover,
   other individual marking, AI cadence, movement, collisions, foul laws,
   goalkeeper handling, match restarts and deterministic command pipeline.
   If the coordination prerequisites fail, the original planner runs.
6. On a real carrier change, pressers are re-ranked at the updated ball
   position, and the previous presser's 3.5m continuity preference is
   applicable only within 9m of the new carrier. This discourages chasing
   a remote old target while retaining stability for nearby defending.
7. A screen remains **passive while the ball is controlled**. The existing
   S1.1 pass-flight continuity system may make it physically eligible to
   intercept if a truly executed opponent kick crosses the defended lane.
   A screen never directly awards possession or changes the ball trajectory.

## Keeper-possession regression safeguard

The full simulation regression suite exposed a rare stale tactical snapshot
when a genuine goalkeeper catch occurs in the same decision tick as a
preceding pressing decision. The existing held-keeper team shape is already
the correct authority; the runner now forces a fresh decision **only when**
a genuine held keeper has outfield pressure/pursuit/engagement left over in
the old snapshot. This prevents the opposing team from continuing to chase
a ball in the keeper's hands without accelerating ordinary decisions or
altering keeper physics. The existing live-catch integration test validates
the handoff on the next actual 50ms tick.

## Non-goals and model limitations

- No clairvoyant pass prediction: projected outlets are currently visible
  players with short linear motion. Underlying pass choice can still be
  unexpected or more accurate than the chosen denial lane.
- A cover shadow is a tactical *running target* in this 2D model, not a full
  foot/leg body occlusion or a magical pass-blocking collision volume.
  Actual interception requires genuine swept-ball contact.
- Central penetration and recovery distances and threat weights are
  estimated simulation values, not validated professional tracking data.
- No fatigue accumulation, 3D body orientation blocking, opponent
  pattern learning, new formations or extra pressing UI toggles.
- Central coordination declines near the defending goalmouth to prioritize
  the existing emergency physical challenge rather than denying one pass.
- One additional screen maximum; other defenders remain in established
  individual defensive decisions and cannot teleport.
- No new saved player properties or random rolls; engineVersion changes to
  prevent old replays being silently associated with different decisions.

## Tests and iPhone acceptance

The mirrored PRS-S1.2 unit scenarios cover the first presser's forward-lane
approach, distinct midfield secondary screen, retained cover, absence of
ghost interceptions, real 50ms movement, central receiver handoff, no viable
outlet, no cover, low pressing, no touchline crossover, player-attribute
differences, and actual kicked-ball flight screening.

Also run existing PRS-S1.1 wide trap, 6.9O pressing intensity, DEF-F1,
physical contact, restarts, goalkeeper and match replay tests. Repository CI
runs `npm run typecheck`, `npm run test`, and `npm run build`. The Pages
deployment runs a second `npm run check` and live asset verification.

On iPhone Safari, confirm `BUILD PRS-S1.2` and observe several standard
pressing midfield exchanges. The striker/central midfielder should sometimes
angle the press toward a dangerous forward pass while nearby midfielders
screen **other** lanes and a distinct cover player holds shape. After
a sideways pass, the closest appropriate teammate should take pressure.
If the team has no nearby cover, high danger near its own goal, or no real
forward outlet, keep the normal defense. Try the same seed and tactics to
verify repeatability and report any stalled match tick or oscillatory run.

This design improves plausible positioning; it is not proof of calibrated
real-world football performance without further in-game observation.
