# O11 — Physical opening kick-off

The original diagnostic 4-3-3 coordinates put some attackers across halfway. When the AI was enabled, it immediately chased the stationary centre ball, then carried it toward goal. Phase 6's viewer now opts into a prepared opening formation without affecting established headless test fixtures.

## Law 8 geometry

IFAB Laws of the Game 2026/27, Law 8: all players other than the kicker must be in their own half, opponents must be at least 9.15m from the stationary centre ball, and the ball is in play only when kicked and clearly moves.

Source: https://www.thefa.com/football-rules-governance/lawsandrules/laws/football-11-11/law-8---the-start-and-restart-of-play

The optional validated MatchSetup.kickoff.teamId configures home or away as the taker. The striker is 0.77m from the ball and a midfielder is behind as receiver; opponents begin outside the centre circle. This placement uses the metric pitch's own dimensions.

## Genuine physical kick-off

Before tick 1, the viewer queues two autonomy toggles and one ordinary attemptKick toward the teammate. The current physics checks the taker's proximity and generates a seeded attribute-dependent impulse; no ball position is invented. All autonomous players remain stationary before the successful opening pass produces physical movement. Then the receiver pursues the ball. The original kicker is excluded from automatic second contact until another player has touched it.

This is the opening only. No goal, offside, referee signal, repeated kick-offs or restart-after-out is implemented, and no official match clock or score is shown. Actual physics results still govern the ball; a kick-off pass is attempted, not guaranteed completed.

MatchState and checkpoint schema version 7 validates the optional kick-off marker against its physical command history and event. Older checkpoints fail explicitly rather than silently migrating. Unit/integration checks cover both halves, centre-circle clearance, a stationary pre-kick ball, real contact, AI suppression, replay, checkpoint forgery and unchanged legacy fixtures.

The user must check the actual iPhone Safari behavior after the Actions deployment because Node CI cannot confirm device visuals.
