import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { chooseDynamicSupport, keepTeamFlank } from '../../src/game/ai/support-space'
import { attackingOpportunityAt } from '../../src/game/ai/goal-directed'
import { MatchViewerSession } from '../../src/game/viewer/session'
import type { MatchState } from '../../src/game/match/state'

function stage(advance: boolean) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const teamId = setup.clubs[0].id
  const carrier = initial.players.find(p =>
    p.clubId === teamId && p.formationSlot === 'DM')!
  const rightWing = initial.players.find(p =>
    p.clubId === teamId && p.formationSlot === 'RW')!
  const leftWing = initial.players.find(p =>
    p.clubId === teamId && p.formationSlot === 'LW')!
  const reference = advance ? {xM:80,yM:34} : {xM:48,yM:34}
  const players = initial.players.map(p => p.playerId === carrier.playerId
    ? {...p,position:reference}
    : p.clubId !== teamId
      ? {...p,position:p.formationSlot === 'GK'
        ? {xM:101,yM:34}
        : {xM:94,yM:p.formationSlot === 'RB' || p.formationSlot === 'RW'
          ? 58 : 10}}
      : p)
  const state:MatchState={...initial,players,kickoff:null,
    ball:{...initial.ball, position:reference,
      controllerId:carrier.playerId,
      controlOffset:{xM:0,yM:0},
      lastTouchPlayerId:carrier.playerId},
    ai:{...initial.ai,enabledTeams:[true,true]},
  }
  return {setup,state,carrier,rightWing,leftWing,reference}
}
describe('Phase 6.9F winger half-space support is real geometry',()=>{
  it('offers a purposeful inside channel when a teammate controls the final-third ball',()=>{
    const {setup,state,carrier,rightWing,reference}=stage(true)
    const raw=JSON.stringify(state)
    const options=chooseDynamicSupport(state,setup,carrier.clubId,
      reference,new Set([carrier.playerId]))
    const run=options.get(rightWing.playerId)!
    expect(run).toBeDefined()
    expect(run.target.yM).toBeLessThan(54)
    expect(run.target.yM).toBeGreaterThanOrEqual(41)
    expect(run.target.xM).toBeGreaterThan(reference.xM)
    expect(run.target.xM).toBeLessThanOrEqual(94)
    expect(attackingOpportunityAt(run.target,state.teams[0],
      setup,state.players.filter(p=>p.clubId!==carrier.clubId))).toBeGreaterThan(0)
    expect(state.ball.controllerId).toBe(carrier.playerId)
    expect(state.contactEvents).toHaveLength(0)
    expect(JSON.stringify(state)).toBe(raw)
    expect(chooseDynamicSupport(state,setup,carrier.clubId,
      reference,new Set([carrier.playerId]))).toEqual(options)
  })
  it('preserves established wide outlets outside the final third',()=>{
    const {setup,state,carrier,rightWing,reference}=stage(false)
    const options=chooseDynamicSupport(state,setup,carrier.clubId,
      reference,new Set([carrier.playerId]))
    const run=options.get(rightWing.playerId)!
    expect(run.target.yM).toBeGreaterThanOrEqual(51)
  })
  it('never treats the other team\'s ball as permission to make a scoring run',()=>{
    const {setup,state,carrier,rightWing,reference}=stage(true)
    const opponent = state.players.find(p=>p.clubId!==carrier.clubId)!
    const theirs:MatchState={...state,ball:{...state.ball,
      controllerId:opponent.playerId,lastTouchPlayerId:opponent.playerId}}
    const options=chooseDynamicSupport(theirs,setup,carrier.clubId,
      reference,new Set([carrier.playerId]))
    expect(options.get(rightWing.playerId)!.target.yM).toBeGreaterThanOrEqual(51)
  })
  it('never abandons team-relative half-space discipline',()=>{
    const {setup,leftWing,state,carrier}=stage(true)
    const target=keepTeamFlank(leftWing,{xM:99,yM:34},1,setup)
    expect(target.yM).toBeLessThanOrEqual(27)
    expect(target.xM).toBeLessThanOrEqual(setup.pitch.lengthM-2.5)
    expect(state.ball.controllerId).toBe(carrier.playerId)
  })
  it('keeps seeded checkpoint replay exact after real attacking decisions',()=>{
    const a=new MatchViewerSession(90)
    for(let i=0;i<150 && !a.state.ball.outsidePitch;i++)a.advance(6)
    const restored=restoreFoundationMatch(a.checkpoint())
    a.advance(4);restored.advance(4)
    expect(restored.checkpoint()).toEqual(a.checkpoint())
  })
})
