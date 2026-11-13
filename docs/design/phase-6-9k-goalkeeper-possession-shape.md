# Phase 6.9K — Goalkeeper hand possession is not ordinary open play

## Observation and root cause
The iPhone test showed both squads converging toward a keeper after a genuine catch. Code review confirmed that `planTeamDecisions` treated a ball physically held in the goalkeeper's hands like generic possession: the attacking XI used `chooseDynamicSupport` and `supportTarget` relative to the goalkeeper's position, while opposition's ordinary defensive planner assigned a presser to chase the ball itself. This could pull centre-backs and full-backs towards the keeper and encourage the opposing team to press a safely held ball.

## Mechanism
`planHeldGoalkeeperShape` is triggered **only** by `activeGoalkeeperCatch`, which requires a physically confirmed shot catch, ball controller identity, and the real hands-held ball height. While held:

- **Keeper's XI:** the keeper stays at the genuine caught-ball position. Centre-backs offer different near-front channels (not at the keeper's feet), full-backs provide wide lanes, the holding midfielder offers a forward outlet, central midfielders occupy intermediate lanes, and wide attackers/striker stay further upfield. Targets derive from existing formation anchors, team-specific attacking direction and the actual keeper position. A few local candidate offsets are evaluated against defender distance, ball-to-outlet lane obstruction, other planned receivers and unnecessary travel. Nobody is teleported or granted a touch.
- **Opposing XI:** the outfield block settles relative to the defending side's own formation and current pressing intensity, with **no automatic chase or physical engagement** toward a keeper holding the ball. High press may screen up to two nearby defenders/holding midfielder, standard up to one, low none. The screeners are assigned geometrically plausible receiving lanes in front of an outfielder—not the goalkeeper. No defender is given a fabricated tackle.
- **After release:** the hand-possession planner immediately stops applying once the ball is physically thrown/released, caught possession ceases, or the keeper only controls the ball at foot level. Existing loose-ball recovery, real passes/interceptions, defending and attacking planners resume unchanged.

All decisions are made in the normal bounded tactical-planning snapshot and executed by the existing 50ms player locomotion engine. No arbitrary animations, magnetic running, implicit pass success, synthetic saves or scripted goalkeeper throws.

## Performance and compatibility
The new module is a pure, deterministic planner. Per tactical refresh it evaluates at most nine local candidate targets for each of the ten attacking outfielders, scanning the eleven opponents and already reserved teammate targets; opposition work is bounded to the XI and at most a handful of possible screening players. This executes only while a ball is genuinely held and the existing decision cadence triggers, not on every iPhone Canvas draw.

The checkpoint JSON schema remains v9. The deterministic algorithm version advances to 6.9K; old serialized replays cannot be silently combined with changed tactical logic. Existing physical catch/parry, held-ball delay, physical distribution command and original goalkeeper safety checks are preserved.

## Verification and limitations
Mirrored real-contact fixtures use an actual swept goalkeeper catch on both sides of the pitch. They verify 22 role-aware decisions, two distinct centre-back outlets, no opponent pursuing the keeper, directional correctness, special shape deactivation after physical release, deterministic unmodified state and the existing live-seed catch replay path.

This is **not** a fully tactical GK buildout: goalkeeper distribution still relies on the existing physically aimed, safe short-outlet heuristic, and positional choices use uncalibrated football simulation values. iPhone Safari appearance and actual human-like movement require visual testing. The real GK throw selection remains a basic existing short-outlet heuristic; this phase changes **where** receivers and defenders position themselves, not a simulated multi-action release strategy. If release passes fail or outlets aren't reached by the hold timer, distribution choice timing may need a separate refinement rather than teleporting the receivers.

## Phase 6.9K CI observations
GitHub Actions confirmed strict TypeScript checking, **317/317 tests in 51 files**, and the production build. Seven new keeper-shape unit tests cover real physically swept hand catches at **both** ends of the pitch, distinct CB/FB passing outlets, mirrored directions, opposition nonengagement, pressing-intensity screening, pure output determinism, immediate deactivation when hands release, and the live-seed catch-to-team-replan path.

The same nine-seed short fictional exhibition set observed **13 physically kicked shots**, **5 goalkeeper catches**, and **1 real goal**, compared with **14 shots**, **5 catches**, and **1 goal** on 6.9J. The ordinary intended-receiver-control sample was **129/163** overall, compared with **130/165** prior; for passes shorter than 18m it was **86/102** versus **87/104** prior. These are short diagnostic samples, not professional football calibration. In particular, one fewer shot does **not** establish improved general attacking quality; the intended quality change is the keeper's held-ball distribution positioning, supported by direct behavioural tests. No test thresholds were relaxed.
