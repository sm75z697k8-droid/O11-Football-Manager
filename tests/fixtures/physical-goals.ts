import { expect } from 'vitest'
import type { MatchState } from '../../src/game/match/state'
import type { MatchSetup } from '../../src/game/model/match'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'

/**
 * Older AI baselines assumed an exact 0-0 score in a physically simulated
 * exhibition. A corrected kick can now produce a genuine goal. Verify
 * score accounting AND a plausible physical crossing rather than forcing
 * the old deterministic OUTCOME to stay unchanged after a real physics fix.
 */
export function expectPhysicalGoals(
  state: MatchState, setup: MatchSetup,
): void {
  expect(state.teams.map(t => t.score)).toEqual(
    state.teams.map(team => state.goalEvents.filter(g =>
      g.scoringTeamId === team.clubId).length))
  for (const goal of state.goalEvents) {
    expect(goal.tick).toBeGreaterThan(0)
    expect(state.teams.some(t => t.clubId === goal.scoringTeamId)).toBe(true)
    const lastToucher = state.players.find(p =>
      p.playerId === goal.lastTouchPlayerId)
    expect(lastToucher).toBeDefined()
    expect(goal.ownGoal).toBe(lastToucher!.clubId !== goal.scoringTeamId)
    expect(goal.crossingHeightM).toBeGreaterThanOrEqual(
      BALL_RADIUS_M - 1e-7)
    expect(goal.crossingHeightM).toBeLessThanOrEqual(
      setup.pitch.goalHeightM - BALL_RADIUS_M + 1e-7)
    expect(Math.abs(goal.crossingY - setup.pitch.widthM / 2))
      .toBeLessThanOrEqual(
        setup.pitch.goalWidthM / 2 - BALL_RADIUS_M + 1e-7)
    const touched = state.contactEvents.some(c =>
      c.playerId === goal.lastTouchPlayerId &&
      c.tick <= goal.tick &&
      ['kicked','controlled','miscontrolled','goalKicked',
        'cornerKicked','thrown','thrownIn'].includes(c.outcome)) ||
      state.automaticContactEvents.some(c =>
        c.playerId === goal.lastTouchPlayerId &&
        c.tick <= goal.tick &&
        !['heldOff'].includes(c.outcome))
    expect(touched).toBe(true)
  }
}
