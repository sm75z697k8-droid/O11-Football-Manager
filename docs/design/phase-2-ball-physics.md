# O11 — Phase 2: deterministic ball physics

**Status:** Headless engine implementation, not a playable football match or animated viewer.

## Integrated physics

The single authoritative football, shared by Harbor Athletic and Vale Rovers, starts at the centre of the 105 × 68 metre pitch, with ball-centre height 0.11 metres.

Ball movement models fixed-step ground rolling deceleration, gravity, approximate horizontal air drag, turf impact with energy-losing vertical rebound, reduced horizontal speed on contact, and low-impact settling. Unlike imaginary walls, touchlines and goal lines do not reflect the ball. A boolean outsidePitch reports only when the entire ball has crossed the pitch boundary. It does NOT mean a referee has awarded anything.

The deterministic diagnosticBallLaunch command sets a finite, speed-limited test velocity at the next tick. This is a **test input**, not a player's pass, shot, free kick, dribble or possession. Player movement and stored tactical commands continue to work independently. Two fictional test teams remain the sole fixture.

## Estimated calibration

| Parameter | Current simulation estimate |
|---|---|
| Ball radius | 0.11 metres |
| Gravity | 9.81 m/s² |
| Rolling deceleration | 0.75 m/s² |
| Horizontal air resistance | 0.008 m⁻¹ |
| Turf bounce restitution | 0.54 |
| Horizontal velocity retained after impact | 0.84 |
| Minimum bounce impact speed | 0.85 m/s |
| Maximum diagnostic launch speed | 40 m/s |
| Fixed timestep | 50 milliseconds |

These are **estimated simulation values**, not verified athlete or match measurements. Vertical air drag, spin, Magnus forces, complex collisions and interactions with the goalposts are not implemented. Vertical flight uses a gravitational parabola; ground contact is resolved within a fixed tick.

## Determinism and checkpoint policy

Ball position, three-axis velocity, height and geometric out-of-bounds status are part of the authoritative MatchState. The complete game state and command log can be serialized and continued. Checkpoint schema **v3** explicitly replaces earlier v1/v2 foundation formats; older snapshots are rejected rather than silently misread. Career saving has not been implemented yet.

Replay, physics unit tests and integration tests verify repeated and chunked execution, rolling slowdown, bounces, boundary behavior, malformed commands and invalid checkpoint fields. Numeric consistency is tested under GitHub Actions' Node runtime, not yet cross-browser bit-for-bit.

## Outstanding limitations

There is still no player–ball contact, kick geometry, pass selection, shot skill, possession, goal detection, offside, fouls, referee, real match periods, scoreboard events or tactical AI. The ball can leave the pitch without an invented result.

A future full-screen landscape match viewer must render this exact authoritative state; the existing development webpage remains an illustrative preview. Player contact and tactical agents are separate future stages and require explicit approval.

Run npm run check and npm run benchmark:ball in GitHub Actions. Published HTML/JavaScript/CSS checks protect against the previous blank-screen deployment error. The benchmark is an informational Node test, NOT iPhone Safari performance.
