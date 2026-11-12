import { describe, expect, it } from 'vitest'
import type { MatchSetup } from '../../src/game/model/match'
import type { MatchState, PlayerMatchState } from '../../src/game/match/state'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  defensiveRecoveryTarget, isRelevantDefensiveThreat,
  planDefensiveResponsibilities,
} from '../../src/game/ai/defensive-shape'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { separationM } from '../../src/game/ai/coordination'

const setup = makeFictionalMatchSetup

function controlledThreat(
  setupData: MatchSetup,
  defendingTeam: 'club_harbor' | 'club_vale',
  ballX: number,
): MatchState {
  const original = createFoundationMatch(setupData).getState()
  const attacker = original.players.find(p =>
    p.clubId !== defendingTeam && p.formationSlot === 'ST')!
  const centreBack = original.players.find(p =>
    p.clubId !== defendingTeam && p.formationSlot === 'RCB')!
  // The ball carrier attacks the defending side's goal, while an opposition
  // defender waits UPFIELD close to the old CM anchor. The midfielder must
  // recover towards its own goal, not follow that irrelevant opponent.
  const ball = { xM: ballX, yM: 34 }
  const upfieldX = defendingTeam === 'club_harbor'
    ? Math.min(setupData.pitch.lengthM - 4, ballX + 30)
    : Math.max(4, ballX - 30)
  return {
    ...original,
    ai: { ...original.ai, enabledTeams: [true, true] },
    players: original.players.map(p =>
      p.playerId === attacker.playerId ? { ...p, position: ball } :
      p.playerId === centreBack.playerId ?
        { ...p, position: { xM: upfieldX, yM: 20 } } : p),
    ball: {
      ...original.ball, controllerId: attacker.playerId,
      lastTouchPlayerId: attacker.playerId,
      position: ball, controlOffset: { xM: 0, yM: 0 },
    },
  }
}

describe('Phase 6.5 football-aware defensive transitions', () => {
  it('makes home #8 drop behind an opposing attack instead of marking its defender', () => {
    const fixture = setup()
    const state = controlledThreat(fixture, 'club_harbor', 26)
    const midfielder = state.players.find(p =>
      p.clubId === 'club_harbor' && p.shirtNumber === 8)!
    const farDefender = state.players.find(p =>
      p.clubId === 'club_vale' && p.formationSlot === 'RCB')!
    expect(isRelevantDefensiveThreat(
      farDefender, state.ball.position, state.teams[0], fixture)).toBe(false)
    const plan = planTeamDecisions(state, fixture)
    const response = plan.find(d => d.playerId === midfielder.playerId)!
    expect(response.action).toBe('recover')
    expect(response.engage).toBe(false)
    expect(response.target.xM).toBeLessThanOrEqual(state.ball.position.xM - 6)
    expect(response.target.xM).toBeLessThan(midfielder.position.xM - 10)
    expect(response.target.yM).toBeLessThan(fixture.pitch.widthM / 2)
  })

  it('makes away #8 recover in the mirrored direction without swapping flanks', () => {
    const fixture = setup()
    const state = controlledThreat(fixture, 'club_vale', 79)
    const midfielder = state.players.find(p =>
      p.clubId === 'club_vale' && p.shirtNumber === 8)!
    const response = planTeamDecisions(state, fixture).find(d =>
      d.playerId === midfielder.playerId)!
    expect(response.action).toBe('recover')
    expect(response.target.xM).toBeGreaterThanOrEqual(state.ball.position.xM + 6)
    expect(response.target.xM).toBeGreaterThan(midfielder.position.xM + 10)
    expect(response.target.yM).toBeGreaterThan(fixture.pitch.widthM / 2)
  })

  it('assigns 11 distinct responsibilities, protecting defenders and the goalkeeper', () => {
    const fixture = setup()
    const state = controlledThreat(fixture, 'club_harbor', 32)
    const decisions = planTeamDecisions(state, fixture)
      .filter(d => d.clubId === 'club_harbor')
    expect(decisions).toHaveLength(11)
    expect(new Set(decisions.map(d => d.playerId)).size).toBe(11)
    expect(decisions.filter(d => d.action === 'press')).toHaveLength(1)
    expect(decisions.filter(d => d.action === 'cover')).toHaveLength(1)
    expect(decisions.some(d => d.action === 'recover')).toBe(true)
    expect(decisions.filter(d => d.engage)).toHaveLength(1)
    const keeper = state.players.find(p =>
      p.clubId === 'club_harbor' && p.formationSlot === 'GK')!
    expect(decisions.find(d => d.playerId === keeper.playerId)).toMatchObject({
      action: 'shape', engage: false,
    })
    const centreBacks = decisions.filter(d => {
      const p = state.players.find(p => p.playerId === d.playerId)!
      return p.formationSlot === 'RCB' || p.formationSlot === 'LCB'
    })
    expect(centreBacks.every(d => d.action !== 'press')).toBe(true)
    expect(centreBacks.every(d => d.target.xM < state.ball.position.xM)).toBe(true)
  })

  it('limits the high press to two challengers while low pressing stays cautious', () => {
    const fixture = setup()
    const original = controlledThreat(fixture, 'club_harbor', 45)
    const high: MatchState = {
      ...original,
      teams: [{ ...original.teams[0], pressingIntensity: 'high' },
        original.teams[1]],
    }
    const low: MatchState = {
      ...original,
      teams: [{ ...original.teams[0], pressingIntensity: 'low' },
        original.teams[1]],
    }
    const count = (state: MatchState) => planTeamDecisions(state, fixture)
      .filter(d => d.clubId === 'club_harbor' && d.action === 'press').length
    expect(count(high)).toBe(2)
    expect(count(low)).toBeLessThan(count(high))
  })

  it('marks a genuine attacking threat only near the compact defensive block', () => {
    const fixture = setup()
    const state = controlledThreat(fixture, 'club_harbor', 35)
    const homeMidfielder = state.players.find(p =>
      p.clubId === 'club_harbor' && p.formationSlot === 'LCM')!
    const recovery = defensiveRecoveryTarget(
      homeMidfielder, state.ai.formationPositions[homeMidfielder.playerId],
      state.ball.position, state.teams[0], fixture)
    const threateningAttacker = state.players.find(p =>
      p.clubId === 'club_vale' && p.formationSlot === 'LW')!
    const farDefender = state.players.find(p =>
      p.clubId === 'club_vale' && p.formationSlot === 'RCB')!
    const modified: MatchState = {
      ...state,
      players: state.players.map(p =>
        p.playerId === threateningAttacker.playerId ?
          { ...p, position: { xM: recovery.xM + 4, yM: recovery.yM + 2 } } :
        p),
    }
    const updatedThreat = modified.players.find(p =>
      p.playerId === threateningAttacker.playerId)!
    expect(isRelevantDefensiveThreat(
      updatedThreat, state.ball.position, state.teams[0], fixture)).toBe(true)
    expect(isRelevantDefensiveThreat(
      farDefender, state.ball.position, state.teams[0], fixture)).toBe(false)
    const plan = planDefensiveResponsibilities(
      modified, fixture, modified.teams[0], modified.ball.position)
    const markerIds = [...plan.entries()].filter(([_, assignment]) =>
      assignment.action === 'mark').map(([id]) => id)
    expect(markerIds.length).toBeGreaterThanOrEqual(1)
    for (const id of markerIds) {
      const markingPlayer = modified.players.find(p => p.playerId === id)!
      const recoveryPoint = defensiveRecoveryTarget(markingPlayer,
        modified.ai.formationPositions[id], modified.ball.position,
        modified.teams[0], fixture)
      expect(separationM(plan.get(id)!.target, recoveryPoint)).toBeLessThanOrEqual(8.01)
    }
  })

  it('keeps player state and physics untouched while calculating defensive plans', () => {
    const fixture = setup()
    const state = controlledThreat(fixture, 'club_vale', 71)
    const before = JSON.stringify(state)
    const first = planDefensiveResponsibilities(
      state, fixture, state.teams[1], state.ball.position)
    const second = planDefensiveResponsibilities(
      state, fixture, state.teams[1], state.ball.position)
    expect([...first]).toEqual([...second])
    expect(JSON.stringify(state)).toBe(before)
    expect(state.contactEvents).toHaveLength(0)
  })

  it('preserves legal bounded destinations for both teams, all eleven roles', () => {
    const fixture = setup()
    for (const teamId of ['club_harbor', 'club_vale'] as const) {
      const state = controlledThreat(fixture, teamId,
        teamId === 'club_harbor' ? 34 : 71)
      const team = state.teams.find(t => t.clubId === teamId)!
      const assignments = planDefensiveResponsibilities(
        state, fixture, team, state.ball.position)
      expect(assignments.size).toBe(11)
      for (const assignment of assignments.values()) {
        expect(Number.isFinite(assignment.target.xM)).toBe(true)
        expect(Number.isFinite(assignment.target.yM)).toBe(true)
        expect(assignment.target.xM).toBeGreaterThanOrEqual(2.5)
        expect(assignment.target.xM).toBeLessThanOrEqual(fixture.pitch.lengthM - 2.5)
        expect(assignment.target.yM).toBeGreaterThanOrEqual(2.5)
        expect(assignment.target.yM).toBeLessThanOrEqual(fixture.pitch.widthM - 2.5)
      }
    }
  })

  it('continues existing attacking support without defensive-role overrides', () => {
    const fixture = setup()
    const state = controlledThreat(fixture, 'club_harbor', 38)
    const away = planTeamDecisions(state, fixture).filter(d =>
      d.clubId === 'club_vale')
    expect(away.some(d => d.action === 'carry')).toBe(true)
    expect(away.some(d => d.action === 'support')).toBe(true)
    expect(away.every(d => d.action !== 'recover')).toBe(true)
  })

  it('replays real 22-player defensive behavior exactly from a checkpoint', () => {
    const fixture = setup()
    const engine = createFoundationMatch(fixture)
    for (const club of fixture.clubs) {
      expect(engine.submitCommand({
        commandId: 'enable-def-' + club.id, type: 'setAutonomousTeam',
        teamId: club.id, enabled: true,
      }).accepted).toBe(true)
    }
    engine.advance(330)
    const clone = restoreFoundationMatch(engine.checkpoint())
    engine.advance(100)
    clone.advance(27)
    clone.advance(73)
    expect(clone.checkpoint()).toEqual(engine.checkpoint())
    expect(engine.getState().players).toHaveLength(22)
    expect(engine.getState().teams.map(t => t.score)).toEqual([0, 0])
  })
})
