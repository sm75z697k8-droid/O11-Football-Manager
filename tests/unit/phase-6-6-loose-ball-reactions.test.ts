import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import type { MatchState } from '../../src/game/match/state'
import {
  assessLooseBallRace, followMovingLooseBall,
} from '../../src/game/ai/loose-ball'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { runAutonomousDecisions } from '../../src/game/ai/runner'
import { AI_PASS_MIN_INTERVAL_TICKS } from '../../src/game/ai/possession'

const fixture = makeFictionalMatchSetup

function misplacedPass(): {
  readonly state: MatchState
  readonly setup: ReturnType<typeof fixture>
} {
  const setup = fixture()
  const original = createFoundationMatch(setup).getState()
  const touch = original.players.find(p =>
    p.clubId === 'club_harbor' && p.formationSlot === 'ST')!
  const awayReceiver = original.players.find(p =>
    p.clubId === 'club_vale' && p.formationSlot === 'RCM')!
  const players = original.players.map(p => ({
    ...p, position: p.playerId === awayReceiver.playerId ?
      { xM: 52, yM: 34 } : p.clubId === 'club_harbor' ?
      { xM: 12, yM: p.position.yM } :
      { xM: 83, yM: p.position.yM },
    velocity: { xMps: 0, yMps: 0 },
  }))
  const state: MatchState = {
    ...original, players,
    ai: { ...original.ai, enabledTeams: [true, true] },
    ball: {
      ...original.ball, position: { xM: 54, yM: 34 },
      velocity: { xMps: -2, yMps: 0, zMps: 0 },
      controllerId: null, controlOffset: null,
      lastTouchPlayerId: touch.playerId,
    },
  }
  return { state, setup }
}

describe('Phase 6.6 real loose-ball recognition and link play', () => {
  it('treats a badly misplaced pass as a contest, not automatic last-touch possession', () => {
    const { state, setup } = misplacedPass()
    const race = assessLooseBallRace(state, setup)
    expect(race?.favoredTeamId).toBe('club_vale')
    expect(race?.pursuerIds.club_vale).toBe(
      state.players.find(p => p.clubId === 'club_vale' &&
        p.formationSlot === 'RCM')?.playerId)
    expect(race?.pursuerIds.club_harbor).toBeTruthy()
    expect(race!.arrivalSeconds.club_vale)
      .toBeLessThan(race!.arrivalSeconds.club_harbor)
    expect(state.ball.lastTouchPlayerId)
      .toBe(state.players.find(p => p.clubId === 'club_harbor' &&
        p.formationSlot === 'ST')?.playerId)
  })

  it('assigns a genuine recovery runner from EACH team after a failed pass', () => {
    const { state, setup } = misplacedPass()
    const decisions = planTeamDecisions(state, setup)
    const home = decisions.filter(d => d.clubId === 'club_harbor')
    const away = decisions.filter(d => d.clubId === 'club_vale')
    expect(home).toHaveLength(11)
    expect(away).toHaveLength(11)
    expect(home.filter(d => d.action === 'press' && d.engage).length).toBeGreaterThanOrEqual(1)
    expect(away.filter(d => d.action === 'receive' && d.engage)).toHaveLength(1)
    expect(away.some(d => d.action === 'support')).toBe(true)
    expect(home.some(d => d.action === 'recover')).toBe(true)
    expect(decisions.some(d => d.engage && d.target.xM < 56 && d.target.xM > 45)).toBe(true)
  })

  it('re-evaluates decisions one tick after an actual new contact, not 12 ticks later', () => {
    const { state, setup } = misplacedPass()
    const earlier: MatchState = {
      ...state,
      clock: { ...state.clock, tick: 23 },
      ai: { ...state.ai, lastDecisionTick: 22,
        decisionSnapshot: [] },
      contactEvents: [{
        commandId: 'sample-foot-contact',
        playerId: state.ball.lastTouchPlayerId!,
        kind: 'kick', outcome: 'kicked', tick: 23, drawUsed: 1,
      }],
    }
    const updated = runAutonomousDecisions(earlier, setup)
    expect(updated.ai.lastDecisionTick).toBe(23)
    expect(updated.ai.decisionSnapshot.length).toBe(22)
    expect(updated.ai.decisionSnapshot.some(d => d.engage)).toBe(true)
    expect(updated.ball).toEqual(earlier.ball)
  })

  it('retargets existing loose-ball chasers each physics tick as the ball moves', () => {
    const { state, setup } = misplacedPass()
    const decisions = planTeamDecisions(state, setup)
    const tracked: MatchState = {
      ...state,
      clock: { ...state.clock, tick: 12 },
      ai: { ...state.ai, lastDecisionTick: 12,
        decisionSnapshot: decisions.map(d => ({ ...d, tick: 12 })) },
    }
    const initial = followMovingLooseBall(tracked, setup)
    const moved: MatchState = {
      ...tracked,
      clock: { ...tracked.clock, tick: 13 },
      ball: { ...tracked.ball, position: { xM: 50, yM: 38 },
        velocity: { xMps: -5, yMps: 1, zMps: 0 } },
    }
    const next = followMovingLooseBall(moved, setup)
    const receiverId = decisions.find(d => d.action === 'receive')!.playerId
    const first = initial.ai.decisionSnapshot.find(d => d.playerId === receiverId)!
    const second = next.ai.decisionSnapshot.find(d => d.playerId === receiverId)!
    expect(second.target).not.toEqual(first.target)
    expect(next.players.find(p => p.playerId === receiverId)?.engagesBall).toBe(true)
    expect(next.ball).toEqual(moved.ball)
    expect(next.contactEvents).toEqual(moved.contactEvents)
  })

  it('does not turn every footballer into a chasing agent', () => {
    const { state, setup } = misplacedPass()
    const decisions = planTeamDecisions(state, setup)
    expect(decisions.filter(d => d.engage).length).toBeLessThanOrEqual(4)
    expect(decisions.filter(d => d.action === 'recover').length)
      .toBeGreaterThan(0)
    expect(decisions.filter(d => d.action === 'support').length)
      .toBeGreaterThan(3)
  })

  it('does not chase a controlled or out-of-play ball with loose-ball logic', () => {
    const { state, setup } = misplacedPass()
    const carrier = state.players[0]
    const controlled: MatchState = { ...state,
      ball: { ...state.ball, controllerId: carrier.playerId,
        controlOffset: { xM: 0, yM: 0 } },
    }
    expect(assessLooseBallRace(controlled, setup)).toBeNull()
    expect(followMovingLooseBall(controlled, setup)).toEqual(controlled)
    const out: MatchState = {
      ...state, ball: { ...state.ball, outsidePitch: true },
    }
    expect(assessLooseBallRace(out, setup)).toBeNull()
    expect(followMovingLooseBall(out, setup)).toEqual(out)
  })

  it('allows quicker decisions without removing a pass-attempt cooldown', () => {
    expect(AI_PASS_MIN_INTERVAL_TICKS).toBe(18)
    expect(AI_PASS_MIN_INTERVAL_TICKS).toBeGreaterThanOrEqual(10)
  })

  it('preserves deterministic real 22-player match replay after physical turnovers', () => {
    const setup = fixture()
    const game = createFoundationMatch(setup)
    for (const club of setup.clubs) {
      expect(game.submitCommand({
        commandId: 'loose-ai-' + club.id,
        teamId: club.id, type: 'setAutonomousTeam', enabled: true,
      }).accepted).toBe(true)
    }
    game.advance(300)
    const copy = restoreFoundationMatch(game.checkpoint())
    game.advance(100)
    copy.advance(44)
    copy.advance(56)
    expect(copy.checkpoint()).toEqual(game.checkpoint())
    expect(game.getState().teams.map(t => t.score)).toEqual([0, 0])
  })
})
