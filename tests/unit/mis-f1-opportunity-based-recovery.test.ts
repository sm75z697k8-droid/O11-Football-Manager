import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { estimateInterception } from '../../src/game/ai/coordination'
import { activePassIntent, maintainPassReception, shouldYieldPassReception } from '../../src/game/ai/pass-coordination'
import { CLEAR_RECOVERY_ADVANTAGE_S, assessLooseBallRace } from '../../src/game/ai/loose-ball'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { runAutonomousDecisions } from '../../src/game/ai/runner'
import type { MatchState } from '../../src/game/match/state'

function liveMispass(receiverX = 60, defenderX = 52.4) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const attackerId = initial.teams[0].clubId
  const defenderId = initial.teams[1].clubId
  const passer = initial.players.find(p =>
    p.clubId === attackerId && p.formationSlot === 'ST')!
  const receiver = initial.players.find(p =>
    p.clubId === attackerId && p.formationSlot === 'RCM')!
  const defender = initial.players.find(p =>
    p.clubId === defenderId && p.formationSlot === 'RCM')!
  const players = initial.players.map(p => ({
    ...p,
    position: p.playerId === passer.playerId ? { xM: 40, yM: 34 } :
      p.playerId === receiver.playerId ? { xM: receiverX, yM: 34 } :
      p.playerId === defender.playerId ? { xM: defenderX, yM: 34 } :
      p.clubId === attackerId ? { xM: 9, yM: 12 } :
        { xM: 99, yM: 58 },
    velocity: { xMps: 0, yMps: 0 }, engagesBall: false,
  }))
  const commandId = 'ai-pass-20-' + passer.playerId
  const state: MatchState = {
    ...initial, kickoff: null,
    clock: { ...initial.clock, tick: 24 },
    players,
    ball: {
      ...initial.ball, position: { xM: 52, yM: 34 },
      heightM: BALL_RADIUS_M,
      velocity: { xMps: 1.5, yMps: 0, zMps: 0 },
      controllerId: null, controlOffset: null, outsidePitch: false,
      lastTouchPlayerId: passer.playerId,
    },
    ai: {
      ...initial.ai, enabledTeams: [true, true], lastDecisionTick: 23,
      passIntent: {
        commandId, teamId: attackerId, passerId: passer.playerId,
        receiverId: receiver.playerId, requestedTick: 20,
        target: { xM: receiverX, yM: 34 },
      },
    },
    contactEvents: [{
      commandId, playerId: passer.playerId, tick: 21,
      kind: 'kick', outcome: 'kicked', drawUsed: 1,
    }],
  }
  return { setup, state, receiver, defender, attackerId, defenderId }
}

describe('MIS-F1 opportunity-based mispass recovery', () => {
  it('yields a technically reachable pass when an opponent is clearly first', () => {
    const { setup, state, receiver, defender, attackerId, defenderId } = liveMispass()
    const receiverDefinition = setup.players.find(p => p.id === receiver.playerId)!
    const defenderDefinition = setup.players.find(p => p.id === defender.playerId)!
    const receiverState = state.players.find(p => p.playerId === receiver.playerId)!
    const defenderState = state.players.find(p => p.playerId === defender.playerId)!
    const receiverReach = estimateInterception(receiverState, receiverDefinition, state.ball, setup.pitch)
    const defenderReach = estimateInterception(defenderState, defenderDefinition, state.ball, setup.pitch)
    expect(receiverReach).not.toBeNull()
    expect(defenderReach).not.toBeNull()
    expect(defenderReach!.etaSeconds + CLEAR_RECOVERY_ADVANTAGE_S).toBeLessThan(receiverReach!.etaSeconds)
    expect(shouldYieldPassReception(state, setup, activePassIntent(state)!)).toBe(true)

    const raw = JSON.stringify(state)
    const next = runAutonomousDecisions(state, setup)
    const abandoned = next.ai.decisionSnapshot.find(d => d.playerId === receiver.playerId)!
    const intercepting = next.ai.decisionSnapshot.find(d => d.playerId === defender.playerId)!
    expect(next.ai.passIntent).toBeNull()
    expect(next.ai.lastDecisionTick).toBe(24)
    expect(abandoned.engage).toBe(false)
    expect(intercepting.action).toBe('receive')
    expect(intercepting.engage).toBe(true)
    expect(next.ai.decisionSnapshot.filter(d => d.clubId === attackerId && d.engage)).toHaveLength(0)
    expect(next.ai.decisionSnapshot.filter(d => d.clubId === defenderId && d.engage).length).toBeGreaterThanOrEqual(1)
    expect(next.ball).toEqual(state.ball)
    expect(next.contactEvents).toEqual(state.contactEvents)
    expect(next.automaticContactEvents).toEqual(state.automaticContactEvents)
    expect(JSON.stringify(state)).toBe(raw)
  })

  it('keeps an intentional, winnable reception without premature handoff', () => {
    const { setup, state, receiver } = liveMispass(53, 55.5)
    const intent = activePassIntent(state)!
    expect(shouldYieldPassReception(state, setup, intent)).toBe(false)
    const continued = maintainPassReception(state, setup)
    expect(continued.ai.passIntent).toEqual(intent)
    expect(continued.players.find(p => p.playerId === receiver.playerId)!.engagesBall).toBe(true)
  })

  it('does not declare a marginal contested race already lost', () => {
    const { setup, state } = liveMispass(53.1, 53.3)
    const race = assessLooseBallRace(state, setup)!
    expect(Math.abs(race.arrivalSeconds.club_harbor - race.arrivalSeconds.club_vale))
      .toBeLessThan(CLEAR_RECOVERY_ADVANTAGE_S)
    expect(shouldYieldPassReception(state, setup, activePassIntent(state)!)).toBe(false)
  })

  it('keeps the original recovery decision deterministic across evaluation', () => {
    const { setup, state } = liveMispass()
    expect(planTeamDecisions(state, setup)).toEqual(planTeamDecisions(state, setup))
    expect(runAutonomousDecisions(state, setup)).toEqual(runAutonomousDecisions(state, setup))
    const engine = createFoundationMatch(setup)
    engine.advance(42)
    const restored = restoreFoundationMatch(engine.checkpoint())
    engine.advance(20)
    restored.advance(20)
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
  })
})
