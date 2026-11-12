# Phase 6.9G — Third-man attacking combinations

## Problem
The existing support AI made independent decisions around the current ball, and even after an actual pass was kicked, the *next* attacker rarely began moving into a dangerous channel. The receiver might control a real pass only to find every other teammate standing in a less useful static outlet. Blindly increasing passing frequency or forcing shots would conceal the problem without adding tactical intelligence.

## Architecture
`combination-runs.ts` is a pure, bounded advisor. It only activates when:
- an active AI pass intent is associated with a **genuinely kicked ball**, as verified against `contactEvents`, OR the receiving teammate has just genuinely taken control of a recent same-team pass;
- during flight, the ball is loose, still last touched by the passer, and the initial receiver remains in charge of the intended interception; after controlled reception, the receiving player must be the actual controller and the event chronology cannot include an intervening deflection;
- a projected physically attainable reception lies 13–41 metres from the opposition goal, with the pass no more than 26 ticks (1.3 seconds) old;
- the target runner is a separate ST, RCM or LCM and can reach a useful target with a real run of no more than 18m;
- the target has sufficient separation from opposition players, a clear passing corridor from the prospective receiver, credible shooting geometry, and a conservative forward-line cap based on the second-last defender.

Only one candidate gets the extra `supportOpportunity` in the existing team-level support allocator. The target is compared against all original outlet candidates, so the support player is not automatically assigned the run. The original receiver remains the **only designated physical ball-chaser**. A defender can intercept the pass at any stage; the future combination does not complete by itself. After a real controlled reception, the same candidate calculation may persist for up to 22 ticks (1.1 simulated seconds), giving the next midfielder or striker time to offer a physically reachable continuation. It never triggers merely because a pass command was queued.

Offside is still only approximated for target placement; the match engine does NOT officiate offside or award assists. No keeper catches, shots or goals are generated for presentation purposes.

## Verification
- A staged physically kicked pass tests coordinated receiver + third-man behaviour.
- Gated tests reject pending, unsuccessful, intercepted, owned, expired and deep-ball situations.
- Repeated snapshots remain deterministic and immutable; checkpoint schema stays v9 and the match algorithm version advances.
- Live multi-seed integration reports distinct candidate third-man offers alongside actual physically kicked shots and recorded goalkeeper catches/parries. An offer is never counted as a successful combination.
- All existing pass completion, goal, GK handling and iPhone performance limits must survive CI. Run manual iPhone Safari checks after deployment.

This is the first attacking combination layer, not fully realized one-twos, overlapping fullbacks, tactical cutbacks, set pieces, calibrated xG or complete competition football rules.
