# O11 Phase 6.7 — Goal-directed attacking decisions and physical goals

## Why this is necessary

The user observed that Phase 6.6 footballers now pass more frequently, but don't recognize a purpose to their possession and rarely attack the goal. Prior AI offered only `carry` and `pass`; an explicit penalty deterred carrying near the goal line, and a safe passing lane could score higher utility than a goalward opportunity. The engine had no shot command distinction or goal-line adjudication.

## New tactical decision loop

`src/game/ai/goal-directed.ts` evaluates a credible shooting opportunity based on distance to goal, lateral shooting angle, non-keeper defenders blocking the shooting corridor, the footballer's Finishing/Long Shots/Technique/Composure attributes, and goalkeeper lateral positioning. This produces a utility and physically aimed `attemptKick` target, **not** a predetermined chance result. Midfield passes gain value only if they improve the recipient's estimated attacking opportunity; repeated lateral/backward recycling in the final third is penalized when a carrier has time and space. Carries that genuinely improve sight of goal gain utility. A reasonable pass remains possible under pressure.

The AI selects among `carry`, `pass` and `shoot`. A shot uses the existing command pipeline with `ai-shot-*` ID, real facing/accuracy angle and power/lift, now weighted toward Finishing and Long Shots rather than Passing. Existing `ai-pass-*` commands retain explicit receiver tracking. The global 12-tick contact attempt throttle remains an early-engine approximation.

## Goal adjudication

`src/game/match/goals.ts` detects the **whole physical ball** crossing the x=0 or x=length goal-line plane (including radius), checks interpolated crossing height below the crossbar and y-coordinate inside both posts (with radius allowances), and recognizes the appropriate scoring team from its attacking direction. It can detect own goals from the real last toucher. A diagnostic launch without any player touch is **not** treated as a genuine goal.

The authoritative `goalEvents` match-state log and team scores are updated together. The match is stopped immediately after its first goal because **no goal restart, full match clock or refereeing rules exist**. Non-goal boundary exits still receive the old accurate out-of-play stop. The viewer displays physical 0:0 scoring, actual goal events, and a goal banner—not precomputed scoring.

## Goalkeeper

The defensive goalkeeper can react to a confirmed physical opposition shot. A deterministic estimate of where the shot will arrive near its goal determines a bounded keeper movement target. The keeper moves using the existing acceleration/speed constraints and attempts physical swept-ball contact rather than automatically saving it. The automatic contact geometry permits a modest 1.55m lateral and 2.17m vertical hand reach while facing a genuinely recorded shot, with existing automatic-contact interception/deflection outcomes and goalkeeper reflexes/handling. It is **not** yet a full diving/handling/parry animation system and the ball may snap to a simplified close-control position when caught.

## Compatibility and boundaries

- Match and checkpoint version are bumped to **9**, including one bounded goal event and physically verified score. Older version-8 diagnostic checkpoints cannot be replayed under changed AI rules.
- The game remains a deterministic 20Hz simulation. No false results, invisible goals, AI-decided winners or decorative shots are invented.
- Existing formation width, press/cover roles, ball physics, contact RNG, command validation and 2D screen projection remain authoritative. All attributes, shooting rewards, save limits and physical reach are **estimated values** not calibrated real football probabilities.
- **Still missing:** standard match periods, half-times, goal restarts, actual goalkeeper holding/distribution controls, the real ball hitting posts/crossbar, official offsides, fouls, corners, goal kicks, throw-ins and professional player collision avoidance. This is one-goal exhibition gameplay only, **not Football Manager-level AI**.
- Performance and visually perceived realism require the user's actual iPhone feedback. GitHub CI verifies code correctness and deterministic replay, not actual Safari FPS.
