import type { PitchDefinition } from '../model/pitch'
import type { BallMatchState, GoalEvent, MatchState } from './state'
import type { MatchSetup } from '../model/match'
import { BALL_RADIUS_M } from '../physics/ball'
import { postGoalKickoffAward } from './post-goal-kickoff'

/**
 * Goal-line geometry in the same 105 x 68 metre coordinates as ball physics.
 * No xG roll, predetermined score, cosmetic goal or screen-space hitbox.
 * A goal occurs only once the WHOLE ball crosses between the posts and
 * under the crossbar after a real player touch.
 */
export const GOAL_LINE_VERSION = 'physical-whole-ball-goals-v1'

export type GoalMouthCrossing = Pick<GoalEvent,
  'side' | 'crossingY' | 'crossingHeightM'>

export function detectGoalMouthCrossing(
  before: BallMatchState, after: BallMatchState,
  pitch: PitchDefinition,
): GoalMouthCrossing | null {
  if (before.outsidePitch || !after.outsidePitch ||
      after.controllerId !== null && !after.lastTouchPlayerId) return null
  const dx = after.position.xM - before.position.xM
  if (Math.abs(dx) < 1e-10) return null
  const boundary = dx > 0 ? pitch.lengthM + BALL_RADIUS_M : -BALL_RADIUS_M
  if (dx > 0 && (before.position.xM >= boundary ||
      after.position.xM < boundary)) return null
  if (dx < 0 && (before.position.xM <= boundary ||
      after.position.xM > boundary)) return null
  const fraction = (boundary - before.position.xM) / dx
  if (fraction < 0 || fraction > 1) return null
  const crossingY = before.position.yM +
    (after.position.yM - before.position.yM) * fraction
  const crossingHeightM = before.heightM +
    (after.heightM - before.heightM) * fraction
  const halfMouth = pitch.goalWidthM / 2 - BALL_RADIUS_M
  const nearGround = crossingHeightM >= BALL_RADIUS_M - 1e-7
  const underBar = crossingHeightM <= pitch.goalHeightM - BALL_RADIUS_M
  if (!nearGround || !underBar ||
      Math.abs(crossingY - pitch.widthM / 2) > halfMouth) return null
  return {
    side: dx > 0 ? 'right' : 'left',
    crossingY, crossingHeightM,
  }
}

/** Called after real locomotion, ball flight, touches and keeper challenges.
 * Every distinct physical crossing can score; it is followed by an
 * independently staged, physical centre restart for the conceding team.
 */
export function adjudicatePhysicalGoal(
  before: MatchState, after: MatchState, setup: MatchSetup,
): MatchState {
  if (after.goalEvents.length !== before.goalEvents.length ||
      after.postGoalKickoff !== null ||
      after.kickoff?.phase === 'awaitingKick' ||
      after.ball.lastTouchPlayerId === null) return after
  const crossed = detectGoalMouthCrossing(before.ball, after.ball, setup.pitch)
  if (!crossed) return after
  const scorer = after.players.find(p =>
    p.playerId === after.ball.lastTouchPlayerId)
  if (!scorer) return after
  const scoringTeam = after.teams.find(team =>
    team.attackingDirection === (crossed.side === 'right' ? 1 : -1))
  if (!scoringTeam) throw new Error('Goal-side attacking direction is missing')
  const goal: GoalEvent = {
    tick: after.clock.tick,
    scoringTeamId: scoringTeam.clubId,
    lastTouchPlayerId: scorer.playerId,
    ownGoal: scorer.clubId !== scoringTeam.clubId,
    ...crossed,
  }
  const updated: MatchState = {
    ...after,
    teams: after.teams.map(team => ({
      ...team, score: team.score + (team.clubId === goal.scoringTeamId ? 1 : 0),
    })) as unknown as MatchState['teams'],
    goalEvents: [...after.goalEvents, goal],
    // Referee replaces the dead scored ball on the centre mark. This is
    // an actual legal restart placement, NOT a teleporting active pass.
    ball: {
      ...after.ball,
      position: {
        xM: setup.pitch.lengthM / 2, yM: setup.pitch.widthM / 2,
      },
      heightM: BALL_RADIUS_M,
      velocity: { xMps: 0, yMps: 0, zMps: 0 },
      outsidePitch: false,
      controllerId: null, controlOffset: null,
      // Preserve physical last-touch history until another genuine
      // contact, so checkpoint possession chronology stays auditable.
      lastTouchPlayerId: scorer.playerId,
    },
    ai: { ...after.ai, passIntent: null, decisionSnapshot: [] },
  }
  return {
    ...updated,
    postGoalKickoff: postGoalKickoffAward(updated, setup, goal),
  }
}
