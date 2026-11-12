import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { activePassIntent, maintainPassReception, shouldYieldPassReception } from '../../src/game/ai/pass-coordination'
import { runAutonomousDecisions } from '../../src/game/ai/runner'
import type { MatchState } from '../../src/game/match/state'

function stagedLoosePass(missed: boolean, kicked = true) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const team = setup.clubs[0].id
  const passer = initial.players.find(p => p.clubId === team && p.formationSlot === 'ST')!
  const receiver = initial.players.find(p => p.clubId === team && p.formationSlot === 'RCM')!
  const rescuer = initial.players.find(p => p.clubId === team && p.formationSlot === 'DM')!
  const point = missed ? {xM: 45, yM: 34} : {xM: 69, yM: 34}
  const players = initial.players.map(p => {
    const position = p.playerId === passer.playerId ? {xM: 32,yM: 34} :
      p.playerId === receiver.playerId ?
        (missed ? {xM: 84,yM: 50} : {xM: 71,yM: 34}) :
      p.playerId === rescuer.playerId ?
        (missed ? {xM: 46,yM: 34} : {xM: 18,yM: 12}) :
      p.clubId === team ? {xM: 18,yM: 12} : {xM: 95,yM: 57}
    return {...p,position,velocity:{xMps:0,yMps:0},engagesBall:false}
  })
  const commandId = 'ai-pass-20-' + passer.playerId
  const intent = {
    commandId, teamId:team, passerId:passer.playerId,
    receiverId:receiver.playerId, requestedTick:20,
    target: missed ? {xM:84,yM:50} : {xM:71,yM:34},
  }
  const state: MatchState = {
    ...initial,
    kickoff: null,
    clock: {...initial.clock,tick:24},
    players,
    ball: {...initial.ball,position:point,heightM:BALL_RADIUS_M,
      velocity:{xMps:3,yMps:0,zMps:0},
      controllerId:null,controlOffset:null,outsidePitch:false,
      lastTouchPlayerId:passer.playerId},
    ai: {...initial.ai,enabledTeams:[true,true],
      lastDecisionTick:23,passIntent:intent},
    contactEvents:kicked ? [{
      commandId,playerId:passer.playerId,tick:21,
      kind:'kick' as const,outcome:'kicked' as const,drawUsed:1 as const,
    }] : [],
  }
  return {setup,state,passer,receiver,rescuer}
}

describe('Phase 6.9D physically meaningful recovery handoff', () => {
  it('hands an unreceivable kicked pass to the faster teammate immediately', () => {
    const {setup,state,receiver,rescuer} = stagedLoosePass(true)
    const raw = JSON.stringify(state)
    const intent = activePassIntent(state)!
    expect(shouldYieldPassReception(state,setup,intent)).toBe(true)
    const next = runAutonomousDecisions(state,setup)
    expect(next.ai.passIntent).toBeNull()
    expect(next.ai.lastDecisionTick).toBe(24)
    const recovery = next.ai.decisionSnapshot.find(d => d.playerId === rescuer.playerId)!
    const abandoned = next.ai.decisionSnapshot.find(d => d.playerId === receiver.playerId)!
    expect(recovery.action).toBe('receive')
    expect(recovery.engage).toBe(true)
    expect(abandoned.engage).toBe(false)
    expect(next.players.find(p => p.playerId === rescuer.playerId)!.engagesBall).toBe(true)
    expect(next.players.find(p => p.playerId === receiver.playerId)!.engagesBall).toBe(false)
    expect(next.ball).toEqual(state.ball)
    expect(next.contactEvents).toEqual(state.contactEvents)
    expect(next.automaticContactEvents).toEqual(state.automaticContactEvents)
    expect(JSON.stringify(state)).toBe(raw)
  })
  it('preserves a plausible original reception without premature handoff', () => {
    const {setup,state,receiver} = stagedLoosePass(false)
    const intent = activePassIntent(state)!
    expect(shouldYieldPassReception(state,setup,intent)).toBe(false)
    const next = maintainPassReception(state,setup)
    expect(next.ai.passIntent).toEqual(intent)
    expect(next.players.find(p => p.playerId === receiver.playerId)!.engagesBall).toBe(true)
    expect(next.ai.lastDecisionTick).toBe(23)
  })
  it('never switches a queued pass before it has genuinely been kicked', () => {
    const {setup,state} = stagedLoosePass(true,false)
    const intent = activePassIntent(state)!
    expect(shouldYieldPassReception(state,setup,intent)).toBe(false)
    expect(maintainPassReception(state,setup).ai.passIntent).toEqual(intent)
  })
  it('does not re-run expensive recovery comparisons every physical tick', () => {
    const {setup,state} = stagedLoosePass(true)
    const current = {...state,clock:{...state.clock,tick:25}}
    expect(shouldYieldPassReception(current,setup,activePassIntent(current)!)).toBe(false)
  })
  it('preserves unchanged checkpoint schema and deterministic simulation', () => {
    const {setup,state} = stagedLoosePass(true)
    const a = runAutonomousDecisions(state,setup)
    const b = runAutonomousDecisions(state,setup)
    expect(a).toEqual(b)
    const engine = createFoundationMatch(setup)
    engine.advance(40)
    const snapshot = engine.checkpoint()
    expect(snapshot.state.schemaVersion).toBe(9)
    expect(restoreFoundationMatch(snapshot).checkpoint()).toEqual(snapshot)
  })
})
