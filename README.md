## THR-F1 — Lawful, pressure-aware physical throw-ins (both teams, both halves)

The first S1.1 throw-in implementation correctly awarded touchline restarts and executed an actual seeded, airborne hand release, but its AI selected the first nearby receiver from two fixed targets and ignored opposing pressure and the Law 15 two-metre exclusion zone. Its hardcoded home/away direction also inverted forward/backward support after the teams switched ends at halftime.

THR-F1 retains the same one-authority 50ms match physics, legal awards, no direct throw-in goals, and thrower second-touch restriction. It now stages a throwing player close to the painted line, offers **three stable, physically moving outlets** (forward, backward and deeper inside), compares available receivers using the same real ball flight/landing predictor shared with the actual overhead throw launch, technical first touch, incoming distance, marking congestion and the CURRENT half's attacking direction. This is tactical advice and a genuinely aimed **throw command**, not a pre-awarded completed pass. The actual throw still consumes the same seeded error, loft and flight, and real defenders/receivers must reach the moving ball to touch it.

Defenders may move to mark nearby outlets, but any opponent within the real Law 15 two-metre exclusion must first move out using normal acceleration and braking. A command must pass the real release-tick geometry and the thrower must be within the line stance zone. An unsuccessful commanded attempt no longer leaves a stale intended receiver or permanently consumes the only command identifier: the real taker can retry from the same award when everyone is legally ready. For the 2026–27 rules, the referee's new five-second countdown applies when the referee **judges unfair delay**, rather than indiscriminately after every throw-in; this version does not invent disciplinary judgements or card events. Arm animation, precise feet/hand joint kinematics and time-wasting cautions are not yet simulated; 1.85m is a documented estimated overhead-release proxy. No game schema migration is needed.

To validate on an iPhone, watch touchline throw-ins from both sidelines: the taker approaches the chalk, forward and safe backward/inside options form naturally, nearby defenders back away or mark, and the taker can select a safer open option. Every result remains determined by genuine ball trajectory and contact rather than guaranteed reception. Automated tests cover left/right attacking directions, both touchlines, both sides, marked receivers, physical clearance, successful lofted release, and deterministic seeded replay.

---

## BOX-F1 — Stop immediate self-deflections after a physical shot or pass

The user's iPhone match diagnostic for production **seed 075BCD15**, **keeper-comparison** preset, shows that Vale player 10 actually performed a physical shot at tick 1047, but the same shooter automatically `deflected` that shot just one 50ms tick later at tick 1048. The initial goalmouth symptom was therefore not proof of failed dribble control: a successful shot was itself being interrupted by an unintended immediate second automatic player-ball collision. This is a concrete match-data defect that can apply to ordinary passes and clearances as well.

BOX-F1 changes only the automatic **interception candidate** check in `src/game/physics/automatic-contact.ts`. Following a genuinely executed foot kick, the original kicker cannot automatically recontact their outgoing ball while the same kick is still leaving their foot-contact envelope. The protection requires a true successful kick with matching ball last-touch history, a recent release and real relative player/ball geometry. For the first two 50ms ticks, contact is treated as the original release rather than a new automatic touch; afterward it is protected only while the ball remains within reach and moves outward, up to a strict eight-tick ceiling. Once it has physically separated beyond foot reach, a returning ball is fair game. **No defender, goalkeeper, or other teammate is made immune to interception.** Genuine rebounding balls and regular tackles still follow the existing swept-ball resolver, and ordinary explicit foot kicks remain subject to the existing contact and restart laws.

The production-seed replay and focused tests check both attacking directions, shots and passes, unrestricted physical blocking by defenders, real returning contact after separation, and deterministic checkpoint replay. Existing goalkeeper saves, aerial duels, corners, shooting, goals, and full-match tests remain part of the required CI gate. The fix does **not** yet alter shooting angle eligibility or fast in-box replanning: those are separate tactical topics to assess with later seeds.

---

## COR-S1 — Physically contested outfield aerial headers (corners + crosses)

This milestone fixes the key missing piece of physically lofted corners: until now, outfielders could only touch airborne deliveries after they dropped to foot level, while the goalkeeper had separate real cross claiming/punching. Both sides now receive **bounded outfield aerial interception plans** for actual wide lofted crosses and corners, using predicted positions from the **same** authoritative 50 ms ball integrator. Plans consider a player's existing location, running acceleration, energy, anticipation, heading and jumping reach. At most two attackers and two defenders are nominated to avoid a homing swarm, and the footballer still needs real physical movement to reach the ball.

The automatic-contact resolver now checks the ball's actual vertical trajectory against a separately bounded **head-height collision interval** for actively assigned outfield header intentions. Player height, vertical leap, anticipation, fatigue and physically elapsed reaction time determine the reachable envelope; each successful intersection competes with defenders and the existing goalkeeper glove collision in the **same earliest-swept-contact arbitration**. A successful header redirects the real moving ball based on heading technique, composure, strength, incoming motion, body angle and nearby challenge; a difficult contact may glance unpredictably off the incoming trajectory. Attacking headers can become genuine goalkeeper-reactable shots and goals only through the existing whole-ball goal-line crossing. Defending headers physically clear the ball; offside phase handling treats a deliberate header as a new play, without granting a shot or possession from an intention alone. No instant repositioning, automatic aerial ownership, predetermined goals or new random success rolls.

**Save compatibility:** no persistent player fields or schema migrations are introduced. Header decisions and header contact records are within existing decision/event logs; restore validation explicitly accepts the new auditable contact kind and outcomes, while old save formats remain legible. **Gameplay limitations:** this is a constrained 2D proxy for vertical jumping, not a leg/body animation, full 3D collisions, headed passing combinations, nuanced marking or all set-piece tactics. Real-seed distributions of headings/goals and iPhone performance need follow-up calibration after the targeted and full automated checks.

---

## PHY-F1 — Continuous, pressure-aware controlled-ball touches

The authoritative 50 ms match runner previously activated its directional close-control helper **only** when a player's ball offset had already become misaligned AND no opposition player was within seven metres. Normal carries thus kept an essentially fixed foot offset, with unnatural movement precisely when the nearest defender challenged. The old isolated close-control tests exercised the helper, but did not verify this important live activation gate.

PHY-F1 corrects the live integration, requiring an actual controlled, moving ball carrier and current tactical carry intent. When the ball has actually become misplaced behind or across the carrier's feet, the live runner now calls the existing bounded, attribute-dependent foot-contact adjustment **every 50 ms until alignment is recovered, including under real opposition pressure**. Already well-positioned ball offsets stay unchanged, avoiding unnecessary changes to physical match sequences. Nearby defenders influence bounded corrective touch length and responsiveness; automated side shielding is deliberately NOT granted without an actual tactical/physical control decision. The existing 0.75 m control-offset cap, max 50 ms displacement, real physical interception/tackling, seed determinism and pitch limits remain in charge. After a real first touch, the ball begins at the physical impact offset and **gradually** responds when the receiving player actively carries; it is not teleported to an arbitrary frontal marker.

Scheduled foot kicks/first touches and stationary passing or shooting preparation explicitly preserve the real pre-kick ball origin. Keeper hand possession is untouched. The code does not manufacture free-ball contacts, automatically award control, assign random losses, or change first-touch success thresholds; those are separate, measurable calibration tasks. It also does not yet model a fully autonomous series of discrete foot taps; this milestone is about continuous carrier foot geometry and first-touch continuity, not a complete physical foot/leg animation model.

New regression tests cover both directions, pressured versus unpressured correction, preservation of already aligned touch points, unchanged ownership and capped offset movement, preserving genuine initial first-touch offsets, no ball movement for pending foot kicks or shots, hand-held keeper protection, and exact-match seeded replay. Further real-match calibration will be needed before claiming first-touch and dribbling realism.

---

## ATT-F1 — Shooting opportunity recognition (finish-or-recycle decisions)

A code audit of the real on-ball AI found that the short-horizon planner formerly penalized delaying a credible immediate shot **only for materially backward passes**. Sideways/short-forward passes and unproductive carrying were not consistently charged for wasting a physically credible finishing window. Passing utilities still rightfully consider player attributes, pressure and receivability, but without comparing this opportunity cost the ball carrier could choose attractive-looking safe circulation instead of a usable shot.

ATT-F1 adds an explainable, deterministic **opportunity cost of delaying a shot** to the existing short-horizon ranking, covering lateral and forward recycling as well as dribbles that do not substantially improve shooting position. Its bounded strength comes from the same existing physical shot windows, estimated on-frame fraction, quality adjusted for the actual shooter's finishing attributes, defender obstruction, goalkeeper coverage, proximity to goal, and the alternative's plausible improvement in sight of goal. A truly better shooting location substantially discounts the cost; a blocked or unreliable shot receives **no special preference**. The system does **not** issue scripted shot commands, raise shot accuracy, assign possession, mint goals, or bypass the normal seeded variation, cooldowns and physical interactions. Both teams use exactly the same calculations, and all thresholds are estimated game-design values rather than real-world probabilities.

The focused regression tests cover sideways and backward missed opportunities, purposeful forward moves, repeated deterministic ranking, physical shot-versus-safe-pass preference, obstructed shooting, individual finishing skill, and both attacking directions, as well as existing shot-window / 90-minute regression tests.

**Important limitations:** This step does not change dribbling physics, first-touch reliability, finishing execution accuracy, or the limited shot eligibility window. It should be evaluated with a series of real seeded matches and shot-refusal/blocked-shot diagnostics before declaring that shot rate, goals per match or mobile performance are realistically calibrated. Continuous controlled-ball physics is the subsequent separately scoped priority (PHY-F1).

---

## GK-S1 — Goal-kick realism: setup, approach, decisions

A targeted code audit found three flaws in the previous S1.2 implementation: the goalkeeper was aimed **0.43 m in front of the dead ball**, short distribution was normally limited to two centre-backs with an emergency midfield kick, and all other outfield players essentially kept their old positions during the dead-ball setup. These facts concern the prior implementation; realistic on-device match behaviour is not yet calibrated.

GK-S1 corrects the keeper's run-up to approach from behind the stationary goal-area ball and requires a real physically oriented upfield approach before commanding contact. Teammates now move through the existing 20 Hz locomotive physics into a bounded 4-3-3 build-out: two centre-backs near the box, two outside full-backs, a central holding midfield outlet, secondary midfield receivers and separated forwards. Opponents inside the penalty area must retreat on foot; standard/high pressing can optionally create a legal outside-area screen. Goal-kick decisions evaluate actual receiver locations, pressure around the first touch, pass-corridor screening, player first-touch attributes and target distance. When centre-backs are pressed, the goalkeeper may use an open full-back/holding midfielder instead of mindlessly passing into pressure, or strike a lofted pass to an actual upfield midfielder. All reception remains physical and fallible; there are no guaranteed passes, automatic ownership changes, scripted goals or direct checkpoint schema changes.

New tests specifically exercise both sides, physical run-ups from unstaged positions, body orientation, non-teleportation, adaptive receivers, crowded short choices, and deterministic option calculations alongside the existing match regression suite. **Remaining realism debt:** physical ball trajectories and kick skill calibration, optional non-GK goal-kick takers, 2026/27 Law 16 five-second countdown, sophisticated pressing triggers and time-bounded whole-team readiness. The estimate constants must be calibrated on iPhone game sessions, not assumed accurate just because automated tests pass.

---

## ATT-S1 — Coordinated attacking movement for the whole 4-3-3

The attack no longer relies on isolated support decisions alone. A dedicated **team-level, deterministic attacking coordinator** can reserve several complementary **physically reachable** off-ball targets while a real outfielder controls the ball in the attacking half: an inside winger, a late-arriving central midfielder, a linking striker, an opposite-side wide outlet, and a conservative/conditional full-back support option.

Run suggestions are **not scripted passes, receptions, shots, goals, or animations**. Every candidate is evaluated against actual teammate and defender positions, individual player movement/technical/mental attributes, defender clearance, the projected passing lane, flank discipline, the current offside line, and walking/running distance. Nearby threats, unsuitable lanes and excessive distances veto runs. The support shape reserves non-colliding targets before filling other players using the existing open-space search. A physically established third-man combination or winger underlap retains precedence, and the intended pass receiver is never replaced. Centre-backs and the defensive midfielder continue their rest-defence positions; full-backs cannot charge forward in attack duty unless the holding midfielder provides cover. No player is instantly repositioned: the existing 20Hz locomotion, stamina, real ball contact and short-horizon possession decisions remain authoritative.

The system applies symmetrically to both teams, with winger/midfielder candidates evaluated before the centre-forward rather than forcing attacks to terminate at the striker. It intentionally **does not guarantee a particular goal scorer or even a shot**, and it does not yet add tactical crossing/cutback decisions, specialized attacking role presets, or opponent-adaptive playbooks. All thresholds are estimated simulation values; true match-calibrated movement frequency and iPhone Safari performance are still to be tested.

New independent unit and integration tests cover mirrored directions, winger and central-midfielder involvement, relative skill, separation, reach, offside-aware ceilings, no-phantom possessions, loss of possession, and deterministic checkpoint replay. The match state/checkpoint *shape* is unchanged; attacks can evolve differently when continuing an earlier save in a newer engine build.

---

## S1.7.1 — Restart-aware physical goal validation

The referee now checks more than crossing the goal line. Every proposed goal is matched to the **latest successful physical player touch** (from the existing commanded touch or swept contact event histories). A missed kick or a failed/held-off tackle does **not** count as an intervening touch; a real save, rebound from a player, interception or deflection does. The ball may bounce from the ground or goal frame without losing the origin of the last player contact.

**Goal legality, IFAB 2026/27:** direct throw-ins into either goal cannot score (goal kick against opponents, corner against the taker's club). A goalkeeper's direct hand throw into the *opponents'* goal is a goal kick. An indirect offside free kick cannot score directly into either goal. A direct own-goal attempt from a kick-off, goal kick, corner kick or direct free kick gives the opposition a corner, while a direct goal into the opponents' net from those legal kicks remains valid. Ordinary physical shots and own goals after another player's actual touch retain normal whole-ball goal adjudication. A legally prohibited crossing **never changes the score or starts a goal celebration**. Instead, the existing goal-line classifier awards and physically stages the correct goal kick or corner from the same crossing—no new phantom restart, ball contact or score is fabricated.

The same rule check now audits historical scored goals during checkpoint restoration, guarding against a save that claims a prohibited direct goal. There is **no new match-state field or checkpoint-format change**: the referee reconstructs eligibility on demand from existing chronological contact events, keeping ordinary 20Hz live ticks lean. Existing successful goals, ball physics, offside decisions and restart flows are preserved. Regression tests cover both attacking directions, own/opposing goals, physical deflections and saves, unsuccessful contact attempts, kick-off variants, direct/indirect kicks, and historic contact order.

Sources: [IFAB Law 8](https://www.theifab.com/laws/latest/the-start-and-restart-of-play/), [Law 10](https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/), [Law 13](https://www.theifab.com/laws/latest/free-kicks/), [Law 15](https://www.theifab.com/laws/latest/the-throw-in/), [Law 16](https://www.theifab.com/laws/latest/the-goal-kick/), [Law 17](https://www.theifab.com/laws/latest/the-corner-kick/).

**Remaining scope:** this does not add new illegal second-touch officiating, referee/outsider ball deflections, throw-in execution offences, or penalty-specific end-of-half timing. These remain distinct future enhancements. The game still needs real iPhone Safari testing for full-match play.

---

## S1.7 — Deliberate tackling, physical fouls and penalties

O11 now separates a **defender's tackle decision** from the ball-contact result. When challenging a controlled carrier, the AI chooses whether to press into the ball or jockey and contain according to angle of approach, tackling, decisions, anticipation, composure, aggression and immediate defensive danger. This runs for either team; it is tactical guidance rather than a forced possession award.

A new **player-body swept contact test** measures the first collision entry across each authoritative 50ms movement step. The referee considers the direction of the impact relative to the ball carrier, actual relative movement speed, defender technique and decision-making, and the carrier's balance. Standing overlaps and ordinary nearby marking do not become fouls; genuinely successful ball-winning challenges are protected. **This is a deliberately conservative, deterministic, uncalibrated foul model—not a random foul percentage or a claim of measured professional player-contact data.**

When an illegal challenge is detected, the referee records the physical contact, stops the ball, and awards a **direct free kick at the contact location**, or a **penalty kick at the authentic eleven-metre mark** if the foul occurred inside the offender's penalty area. The players then move using existing locomotion; defending players give 9.15m on free kicks, and for penalties the keeper returns to the goal line and other outfield players retreat behind the spot and outside the penalty area. The authorized taker **really strikes the stationary ball using the existing accuracy/velocity physics**; no successful kick, penalty goal, or score is pre-scripted. The referee outcome is chronological, included in the checkpoint schema, copyable match diagnostics, and the live match event feed. Halftime, offside and normal out-of-play rules retain priority.

**Important scope limits:** this first stage judges committed challenges on an actively controlled attacker and uses body-entry geometry, not full collision rigid-body responses or animation. A foul does not yet cause player falls, injuries or cards. Purely off-ball fouls, obstruction without ball contact, advantage, simulation/diving, handball, prolonged grabbing, late tackles after already released possession, and yellow/red-card discipline are separate future systems. Penalty run-up styles and kicker/keeper mind-games are not yet calibrated. Values for foul thresholds are simulation estimates; actual live iPhone testing is necessary.

---

## S1.6 — Law 11 physical-touch offside and indirect restarts

O11 now records **which teammates were in an offside position at the instant of an actual physical ball touch** (commanded kick/control/goalkeeper throw or swept contact), using the ball, opponents' half and the second-last defender **including the goalkeeper**. Merely standing offside never stops play. The referee awards offside only when a previously positioned attacker genuinely touches the ball (including an uncontrolled deflection); it does not invent a whistle when a pass is merely selected by the AI. Intentional opponent control resets the attacking phase, but rebounds, deflections and parries retain it. Direct receptions from throw-ins, corners and goal kicks are exempt. Both attacking directions work after halftime.

Each whistle stops active football and awards the defending club a **stationary indirect free kick at the active involvement location**. Players physically approach the restart, opponents must retreat 9.15m (and out of the penalty area where required), the authorized taker kicks with existing attribute-based contact physics, and the match resumes. An untouched indirect free kick cannot score directly. The offside-position snapshot, chronological offences, free-kick state and active indirect status are included in checkpoint validation and copyable match diagnostics. A new checkpoint schema version intentionally invalidates prior saved snapshots. Normal AI avoids passing to teammates projected offside at the instant of its next contact; real referee decisions remain authoritative.

**Current limitation:** interference with an opponent (blocking sight, challenging without reaching the ball) is **not** yet adjudicated, nor are fouls, cautions, penalties or VAR. The phase uses explicit engine touches; continuous dribble touches are approximated by retained ball control. No claim is made of fully calibrated professional offside frequency. These rules use the engine's metric positions, not visual animation.

## S1.5 — Authentic half-time, second half and full-time timing

The iPhone exhibition now has **two genuine 45-minute simulated halves**, each 54,000 authoritative 50 ms physics ticks. The first-half clock starts when the real opening kick physically moves the ball—not when the referee staging screen is shown. Each half includes a **minimum, deterministic added-time estimate**, rounded up to full minutes from the actual simulated time lost while taking throw-ins, goal kicks, corner kicks and post-goal restarts. That allowance is announced at 45:00 / 90:00 and never silently reduced. The accounting is an estimated initial referee model, **not** professional statistical calibration. Fouls, injuries, substitutions, VAR, disciplinary stoppages and extra time are outside this increment, so their future lost-time allowances are not yet simulated.

The first-half whistle **stops the game clock** and presents a manual **Start Second Half** control. The pitch sides change during the half-time interval (not while the ball is live); player energy and all real goals are preserved. Players are legally positioned on the opposite ends with zero live-game velocity, the first-half formation anchors are mirrored, the centre ball is placed stationary and the team that did *not* start the first half is awarded a **real second-half kick-off**. The correct taker must physically strike it from reach, and normal 20 Hz simulation returns only after the ball clearly moves. The same lawfully constrained no-double-touch and deterministic replay rules apply. The iPhone clock and historical event timestamps are now anchored to actual periods, not absolute match-engine tick count. After the second 45-minute period plus added time, the referee blows for full time; the final score is preserved and physics stops.

**Halftime clock and player movement:** The halftime interval is an explicitly user-controlled break; the app doesn't simulate 15 minutes of player walking through a tunnel. Returning players are positioned for a legitimate new period, not teleported during open play. No substitutions or energy recovery is fabricated. Full-length playback at 1× lasts about 90 minutes of simulated active match time (plus added time), with 2× and 4× controls still available; performance and memory for many full-length real-life careers will need further profiling on iPhone Safari.

No manual shortcut accelerates or predetermines the match result. Diagnostic-only physics fixtures without a scheduled opening kickoff remain independent. Because the authoritative match state, sides, and replay timing changed, prior checkpoints are not backward-compatible without a future migration.

## S1.4 — Physical after-goal kickoffs (Law 8)

A **genuine whole-ball goalmouth crossing** now adds a chronological goal to the match log and increments the correct team's score; previous goals and the initial kickoff record are preserved. The conceding team automatically receives a **separate, legal post-goal restart**. A scored ball is placed stationary on the centre mark only after the goal is confirmed by physical goal-line adjudication. This is a dead-ball placement, **not** a fabricated successful kick or possession award.

All 22 players return to their lawful halves using the existing 20Hz acceleration, turning and braking model; the striker taking the kickoff approaches the ball, two midfielders offer safe short options, and all opponents remain at least **9.15 metres** from the centre mark until the ball enters play. Teammate selection considers real first-touch and anticipation attributes. A new, strictly validated goal-specific `attemptKick` is queued only after the team is positioned and the conceding team's AI is active. Existing contact physics and seeded accuracy determine the foot-struck pass. The match only resumes after the football **actually moves** during the subsequent physical tick. The kicker cannot play the ball a second time before another player touches it, as required by Law 8.

S1.4 also removes the former single-goal limit from the authoritative goal log and checkpoint validator, and from the iPhone display. Both teams can score multiple physical goals in one exhibition, with the match continuing after each kickoff. No diagnostic kick, fake score increment, or sudden on-field player teleport is substituted for football. Corner kicks, goal kicks, throw-ins and opening kickoffs remain unchanged.

**Scope limitation:** the match is still an *unbounded exhibition*, not a complete 90-minute competition fixture. Half-time, added time, fouls, substitutions, offside and match-end procedures still require separate future increments. Estimated numerical acceleration and kickoff-planning thresholds are fictional simulation values. Save/checkpoint schema version advances for replay safety.

## S1.3 — Physical corner kicks (Law 17)

O11 now distinguishes a **corner** from an ordinary goal-line or touchline exit and places the stationary ball inside the **nearest 1m corner area**. The corner taker is selected reproducibly from real players' initial tactical positions and set-piece ratings; all participants move using the existing 20Hz locomotion. Attackers offer near-post, far-post and short options. Defenders protect these areas while their team must remain **at least 9.15m from the corner arc until the kick**. No one teleports, and the dead ball cannot be controlled or launched by regular open-play commands.

AI can choose a low short delivery or a lofted cross according to corner technique, opponent congestion and a physically prepared teammate. A new validated `attemptCornerKick` command triggers a genuine skill-affected **foot collision** and seeded angular error. There is no fabricated goal, header or awarded possession. The real ball flight may be intercepted, claimed by the goalkeeper, cleared or go out again; lofted corner kicks feed into the existing GK aerial-decision engine. **Headers and detailed aerial duels are not yet finished**, so short corners and actual outfield response will be refined in a future S3 improvement.

The kicker may not touch their own corner kick again until someone else touches it, matching the existing legal second-touch protection for throw-ins and goal kicks. Checkpoint replay version advances to S1.3 and logs awarded/released corners. The iPhone match viewer stays live during corners.

The full exhibition **still ends after a goal**: post-goal kickoffs, match periods, refereeing offences and full 90-minute match duration are not yet implemented. All physics thresholds and tactical scoring parameters are estimated simulation constants, not measured professional statistics.

## S1.2 — Physical goal-kick restarts

A legally awarded **goal kick** is no longer a terminal match state. After an actual whole-ball goal-line exit with an attacking last touch, the referee places the **stationary dead ball within the defending team's goal area**, never outside the pitch or in the goalkeeper's hands. The goalkeeper physically travels to the ball while both centre-backs offer inside-area build-up options and opposition players retreat beyond the penalty area through existing 20Hz locomotion.

Once the keeper is near the ball, opponents are clear and a receiving option is ready, AI schedules a validated **`attemptGoalKick`**. The ball only returns to normal play when the *physical foot-contact resolver* succeeds; the shot/pass RNG and the goalkeeper's `kickingDistribution`, passing and composure inform the actual kick trajectory. The keeper assesses short outlets and can kick long into midfield if both centre-backs are pressed. The chosen receiver follows the existing physical reception AI—no completion or possession is awarded in advance. The kicker is barred from a second touch before someone else touches the ball, per IFAB Law 16.

New tests exercise both ends, goal-area and opponent clearance, rejection of unauthorized kicks, attributes/trajectory, short and pressured deliveries. `tests/unit/s1-2-goal-kicks.test.ts` is the narrow rule suite. The iPhone match viewer now continues through both throw-ins and goal kicks.

**Still outside S1.2:** corners, kickoffs following goals, complete timekeeping, fouls, offsides, referee enforcement of persistent restart delays and match finishing. These are separate improvements, not silently synthesized restart events. The ball's legal repositioning only occurs **while play is stopped**; outfield and goalkeeper movement remain physical. Previous serialized checkpoints intentionally require migration because the replay schema/engine versions advance. The game uses fictional attributes and estimated calibration values.

## S1.1 — Real touchline restarts (incremental continuity)

The match engine now classifies a **whole-ball exit** by the first crossed pitch line and the physical last-touch player. Touchline exits award the other club a **throw-in**; goal-line exits are correctly classified as a **corner** or **goal kick**. The corner and goal-kick restart mechanisms remain future S1 increments; these are explicit stoppages, not fake throw-ins.

When a legal throw-in is awarded, the ball remains outside play while a selected outfield teammate approaches the correct touchline position and two receiving teammates make real, accelerating runs to consistent supporting targets. With the taker and an outlet ready, AI schedules a **real attemptThrowIn command**. On execution, physical reach/placement are checked, and the taker's long-throws, technique and composure ratings affect an actual lofted 3D ball launch using seeded accuracy variation. The existing physics, interceptions, passing and tactical planning resume on the following physical tick. The receiving teammate retains a coordinated physical-ball interception instruction, and the taker cannot touch the throw again before another player does (Law 15). The lofted release is range-calibrated to its intended outlet, but actual contact and reception still depend on ball trajectory, attributes and opponents. A restart never grants a completed pass, score or possession by decree.

The 2D match viewer now stays active during throw-in staging and indicates the awarded side and club. The physical events panel and debug report expose these events and actual `thrownIn` contact releases. Corners, goal kicks, post-goal kickoffs, offside, fouls and full-period/timekeeping are **not implemented yet**. Goal-line stoppages and scored goals still end the current exhibition instead of pretending full-game continuity exists.

All claims are fictional simulation decisions; this milestone is about rule-compatible restart fundamentals, not professional calibrated match statistics. Because the match-state schema and contact command log have changed, **old serialized checkpoints are intentionally incompatible**. Same-seed replay inside the new engine remains deterministic. Tests cover both touchlines, both clubs, goal-line award classification, diagonal corner boundary geometry and actual release physics.

## Phase 6.9T — Goalkeeper aerial decisions: claims and punches

Goalkeepers now recognize **actual physically kicked, lofted wide deliveries** targeting their own penalty area. The planner checks the latest real contact/command, the source/target geometry, physical ball flight, keeper movement limits and nearby opponents. A goalkeeper can **remain on the line** when the ball is too far or contested, or **move towards a reachable aerial intercept**. It works symmetrically for both fictional teams and uses `crossClaiming`, `commandOfArea`, `positioning` and decision-making attributes. Existing real-shot reflex saves and one-on-one decisions retain priority.

A potential claim is not an awarded save: only a genuine **50ms swept collision** inside the goalkeeper's own penalty area can trigger hand contact. The real ball speed, height, contact separation, crowding and keeper `handling`/`crossClaiming` determine whether the keeper **catches** and holds the ball or **punches** it back into the field with a bounded impulse influenced by `punching`. Punches remain loose-ball events with no invented controller. Claimed catches enter the existing held-ball/physical throw pathway. No cosmetic animations or forced outcomes are introduced.

**Important limitation:** the match AI does not yet consistently generate crosses; this phase handles eligible physically executed high deliveries rather than inventing crosses or modifying attacking decisions. Consequently, normal seeded exhibitions may show few claim/punch events until realistic wing crossing is implemented as a separate attacking-AI improvement. The estimated tactical and handling thresholds are **not calibrated save probabilities**. Existing balanced fixture, keeper comparison mode, outfield AI and match render loop are preserved. `tests/unit/phase-6-9t-goalkeeper-aerial.test.ts` covers mirrored decisions, real contacts and non-cross exclusions.

## Phase 6.9S — Goalkeeper one-on-one decisions and physical smothers

A goalkeeper now recognizes an **isolated opponent dribbling towards their goal**. The AI first checks the carrier's distance, angle, actual movement and whether a defender is already goal-side and close enough to cover the threat. It can **hold its position**, **close the shooting angle**, or **engage a close-range smother** inside its own penalty area. Keeper positioning, decisions, one-on-ones and rushing-out ratings influence its movement. Both teams use the same mirrored geometry; all movement still occurs through the existing physical locomotion.

A smother is **not an awarded animation or automatic save**: the goalkeeper must actually reach the dribbled ball via swept collision, and a handling/one-on-ones/rushing-out judgement is opposed by the carrier's real ball-control attributes. A real successful contact produces a goalkeeper hand catch and enables the established held-ball/throw system; an unsuccessful attempt leaves the attacker in possession. Incoming shots retain full priority under the existing reflex/dive/physical save engine. This is a carefully bounded emergency behaviour—not a sweeper-keeper overhaul or proof of fully realistic one-on-one success rates.

**Testing:** `tests/unit/phase-6-9s-goalkeeper-one-on-one.test.ts` covers both pitch directions, defensive cover, wide/distant threats, physical catches and failed challenges, shot priority and deterministic replay. Gameplay parameters are estimated fictional simulation calibrations. Existing outfield pressing, GK comparison presets and passing logic are intentionally unchanged.

## Phase 6.9R — Controlled goalkeeper profiles for two fictional teams

The landscape match viewer now starts in **GK comparison** mode. Harbor Athletic's fictional goalkeeper is a **reflex specialist** (Reflexes 94, Diving 90, Handling 45), while Vale Rovers' goalkeeper is a **secure handler** (Reflexes 55, Diving 59, Handling 92, Parrying 93). These are deliberately contrasting, **estimated simulation values**, not real player data or save percentages. Both teams still start in 4-3-3 with standard pressing, and every **outfield player's attributes remain unchanged**; this phase tests goalkeeper differences only, not an entire tactical identity or calibrated comparative ability.

Tap the **GK** control in the iPhone landscape match header to inspect both players' actual ratings. Switch between **GK comparison** and **Balanced** (both goalkeepers have the original rating 68) to replay from kick-off with the **same seed**. Replaying within either preset is deterministic; switching presets may produce different later events because actual physical keeper abilities differ. The balanced canonical fixture and historical seeded baseline tests are preserved unchanged. The viewer's seed caption and copied debug report include the fixture preset.

This is a controlled goalkeeper testing feature, not evidence that the new attributes yield realistic save ratios over many matches. See `tests/unit/phase-6-9r-goalkeeper-profiles.test.ts` for profile, validation, physical reaction and replay checks.

## Phase 6.9O — Disciplined pressing instead of constant swarming

The defending AI now decides **when** to press rather than nominating any footballer within 30–38 metres of the carrier. Low pressing generally guards its compact shape, standard pressing looks for a local physical challenge, danger toward goal, a touchline trap or a real fresh first touch, while high pressing remains aggressive and uses a second challenger only for a credible trap. The first presser closes on the goal side of the ball, and its role is stable across nearly equal alternatives; other defenders screen, mark or recover. Cover movement is bounded to its own defensive recovery zone instead of becoming a second long-range sprint toward the ball. Loose-ball recovery, real tackles and the existing 6.9M shot decisions/6.9N close control are preserved.

**Verification:** GitHub strict TypeScript, 360/360 tests in 59 files, Vite build and real low/standard/high match-intensity diagnostics. The short live sample still shows frequent standard pressure in some tightly contested situations, so this is an initial defensive-discipline step, **not** a calibrated model of real football pressing. Nine real seeded exhibition samples produced 7 physically kicked shots / 0 goals in this engine versus 5 shots / 1 goal in 6.9N; these limited data do not establish goal-scoring improvement. See [Phase 6.9O pressing design, testing and limitations](docs/design/phase-6-9o-defensive-pressing.md).

## Phase 6.9N — Directional ball close control during open-space dribbles

A genuine ball carrier can now adjust a poorly aligned foot-ball contact point during an **unopposed AI carry** (no defender within 7 metres), rather than leaving the football permanently at the side or behind the player after an earlier first touch. The authoritative 50ms ball-state position and stored offset turn smoothly toward the player's heading and momentum. Speed plus Dribbling, First Touch, Agility, Balance and Composure ratings influence the resulting control geometry. Corrections are speed-limited and bounded within the physically valid foot-reach envelope; no player spontaneously loses possession without a real kick/tackle event. Existing settled shots, passes, goalkeeper hand catches, real tackles and real goals remain authoritative.

**Scope limitation:** This is a first, small close-control movement improvement, not a full sequence of physically detached dribbling touches, skill moves or realistically fallible heavy touches under pressure. The five-seed live test recorded **179 real close-control corrections, zero unexplained ball-ownership losses across 3,122 controlled ticks**. The short nine-seed attacking sample changed from **14 physical shots to 5** (one real goal in both versions), so this phase is **not** proof that attacking or dribbling decision quality improved overall. Watch chance creation carefully on iPhone and report seed/time if it feels worse. Read [Phase 6.9N implementation and measured limitations](docs/design/phase-6-9n-directional-close-control.md).

## Phase 6.9M — Recognize and take credible shooting chances

After a player receives a genuine pass, the AI can now take an immediate **physical shot** once their first touch is controlled and settled—without waiting for the previous universal 18-tick (0.9-second) team passing cooldown. Passing still obeys that existing cooldown, preventing the old rapid meaningless-passing loop. The shot-release minimum is 4 ticks (0.2 seconds) after the last pass, subject to actual ball ownership and first-touch readiness. Nothing awards a shot or goal without a real physical kick.

The shot-intent planner also examines three on-goal aiming points using a bounded preview of **the actual 50ms ball physics and attribute-dependent angular error**, compares their accuracy margin and approximate goalkeeper coverage, and discourages an unnecessary backward pass **only when** it sacrifices an unobstructed, relatively unpressured immediate shot. A genuinely blocked chance or better receiver may still justify a pass. These are simulation estimates, not xG probabilities or predetermined scoring results.

In 40 constructed shot-ready fixtures, both 6.9L and 6.9M already *wanted* to shoot, but at six ticks after a preceding team pass, old 6.9L authorized **0** shot releases and 6.9M authorized **40**. That is the directly verified defect fix; it is **not** evidence of 40 real goals. Actual nine-seed exhibitions recorded **14 shots and 1 goal** here versus **15 shots and 1 goal** previously, so more real-world shot frequency is **not** established by this small sample. See [Phase 6.9M design and verification](docs/design/phase-6-9m-intelligent-shots-and-release.md).

## Phase 6.9L — Realistic goalkeeper throw choices

Following the 6.9K goalkeeper positioning improvement, a goalkeeper who has **physically caught** the ball now examines whether a real hand-throw trajectory could reach a moving teammate. A bounded rehearsal uses the match engine's own 50ms ball-flight, turning and first-touch collision equations, while estimated opposition interception timing, passing lanes, touchline margins and individual goalkeeper Vision, Decisions, Composure, Technique and Throwing Distribution influence selection. Actual seeded physics still controls the released ball: no pass, interception or reception is awarded by the forecast.

Goalkeepers can wait briefly for a credible outlet, but will choose a riskier real release if safe choices fail to appear rather than holding forever. The distribution mechanism is **still physical throws only**, not rolls, punts or long kicks. Team shapes from 6.9K are retained for both sides, and after the release all normal 22-agent tactics resume.

The historic and current **nine-seed actual throw reception** benchmark is important to interpret correctly: the 6.9K planner recorded **5/5** intended-receiver controls, while the 6.9L planner recorded **4/4** from generally longer distribution choices. This is **not evidence of increased completion probability** and one fewer throw occurred in this sample. The upgrade is to physically informed selection and use of safer/forward options, not guaranteed higher short-run statistics. See [Phase 6.9L implementation and testing](docs/design/phase-6-9l-keeper-throw-intelligence.md).

## Phase 6.9K — Intelligent team positioning after a goalkeeper catches

A physically confirmed goalkeeper **hand catch** now activates a separate team tactical phase instead of treating the keeper as an ordinary foot-level ball carrier. Centre-backs and full-backs spread into passing outlets, midfielders offer progressive positions, and forwards maintain useful attacking depth. The opposition regroups into a coherent block and may screen nearby receivers according to pressing intensity, without racing straight toward a ball securely held in the goalkeeper's hands.

This is implemented for **both sides**, mirrored to each team's direction, using existing formation anchors, real player and opponent positions and bounded space/lane checks. The changes are movement intentions only; real player locomotion, caught-ball physics, existing held-ball delay, thrown-ball trajectory, interceptions and exact seeded match replay stay authoritative. Once the ball leaves the keeper's hands, ordinary AI resumes automatically. See [Phase 6.9K design notes](docs/design/phase-6-9k-goalkeeper-possession-shape.md).

## Phase 6.9J — Long-match command continuity and reproducible iPhone diagnostics

The original match scheduler imposed a **256 total command** lifetime ceiling. Once that number was reached, the autonomous AI could no longer schedule any real passes, shots or goalkeeper distributions, while locomotion and automatic physical contacts continued. That is a confirmed independent source of a *silent action stall* in sufficiently long matches. Phase 6.9J increases the bounded match command capacity to **8192**, retaining exact ordered command logs and schema-v9 checkpoint validation; if that new safety limit is ever exceeded, AI now raises a visible simulation error instead of silently ceasing to kick.

The viewer displays the actual **BUILD 6.9J** next to the seed. In the Player Inspector it shows the used command count and provides **Copy match debug report**, containing the deterministic seed, algorithm version, tick/time, ball/controller, recent physical contacts and last genuine release. The report is generated locally and never sent automatically.

**Reported seed 8BE673A4:** Replaying the exact unsigned seed on both Phase 6.9H and Phase 6.9I reaches normal **out-of-play at 04:58** (tick 5968), after 137 commands. It does **not** reproduce the user's approximate 09:42 stall on those builds. This work fixes the confirmed command-cap risk, **not a verified specific cause of that 09:42 observation**. Compare the newly displayed build number and copy a debug report if the issue recurs.

See [Phase 6.9J investigation and verification](docs/design/phase-6-9j-command-capacity-and-seed-replay.md).

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
