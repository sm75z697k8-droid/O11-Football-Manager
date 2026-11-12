# Phase 6.9I — Stop stale challenge loops without scripted tackles

## Reported failure
During iPhone playback, the match sometimes appears to stop progressing while the physical-contact counter continues increasing. The symptom is not conclusive by itself; a live device trace was not available.

## Reproduced code-level mechanism
The automatic-contact resolver previously allowed a defender who was physically **already inside** the ball-owner's foot-contact reach to make the same failed challenge every 6 simulation ticks (300ms). The owner remained attached to the ball, while an unlimited sequence of `heldOff` automatic contact events was appended. The HUD counted all such events as physical contacts, and the viewer re-sorted complete event arrays frequently on iPhone.

## Fix
When a defender has recently lost a real challenge, a continuing overlap with the **same ball owner** does not count as a new collision. A genuine new approach from outside foot-contact reach is required to re-arm an unsuccessful physical challenge. Fresh touches by any player (controlled passes, interceptions, deflections, successful tackles, shot catches and parries) reset the previous contest; other defenders are never prohibited from challenging. A physical return into reach can produce a new genuine tackle and can still result in a skill-dependent winner. No possession is revoked by timer, no ball is moved artificially, and opponent tackle ability remains authoritative.

## AI continuity under real pressure
An artificial failed-contact stream formerly forced more frequent AI replanning. Carriers are now independently reconsidered at a six-tick tactical interval **only after an actual `heldOff` contact**, while that same defender is still within real foot-contact range and the carrier retains possession. Otherwise the existing 12-tick interval remains. A preliminary broader version that refreshed under all nearby pressure created a major shooting regression and failed the live goalkeeper test, so it was rejected. This adjustment uses actual player positions and foot-reachable ball height, not synthetic contact events. It does not require or create a new physical tackle, change any kick cooldown, or guarantee that a pass or shot succeeds.

The event history is still retained for physics and checkpoint validation. The viewer reuses its already-detached prior-step snapshot (saving a duplicate structured clone), and restricts event-feed processing to recent items rather than sorting unbounded history on every HUD render. A completed goal halts unnecessary animation scheduling while the exhibition awaits restart implementation.

## Tests and limitations
Focused tests create an actual stationary, low-skill failed challenge for 100 ticks, verify a single `heldOff` event, then verify the same challenger can re-enter after moving away, and a different skilled defender can win possession. Viewer tests check both teams remain autonomous and multi-tick interpolation remains physically accurate. Full CI and seeded physical passing/shot/keeper comparisons must remain green before merging.

This repairs a concrete contact-spam failure mode; it does **not** prove all possible late-match stalls are eliminated. AI tactics and player movement in crowded areas may still need separate refinement. Report a seed and timestamp if a future stuck state persists; match seeds allow exact replay.

## Release CI and physical regression observations
Latest GitHub Actions typecheck, **306/306 tests (48 files)** and production build passed. The new synthetic, stationary overlap fixture reports one failed challenge over 100 simulated ticks rather than a new automatic event every 6 ticks. It also verifies a renewed approach after leaving contact range and a second defender winning a legitimate attribute-based challenge.

The nine-seed short exhibition diagnostic recorded **14 physically kicked shots, 5 goalkeeper catches, one real goal** and **130/165** intended-receiver controls (87/104 for passes shorter than 18m). The prior Phase 6.9H sample recorded 14 shots, 4 catches, one goal and 124/159 controls (81/98 under 18m). Differences in sequence and event count are possible because fewer fake challenge events are allowed to trigger tactical changes; none of these values are real-world statistical calibration or a guarantee of full-match stability.

This work prioritizes fixing the newly reported reliability issue. A separate future improvement should enhance purposeful attacking continuity after the user's on-device verification; it does not implement throw-ins, corners or goal kicks.
