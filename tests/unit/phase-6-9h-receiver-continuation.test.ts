import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MatchViewerSession } from '../../src/game/viewer/session'
import {
  evaluateReceiverContinuation, MAX_CONTINUATION_ADJUSTMENT,
} from '../../src/game/ai/receiver-continuation'
import { reviewOnBallActions } from '../../src/game/ai/short-horizon'
import type { MatchState } from '../../src/game/match/state'
import type { Point2 } from '../../src/game/model/pitch'

function stage(
  reception: Point2 = {xM:76,yM:34},
  runnerPosition: Point2 = {xM:88,yM:34},
) {
  const setup = makeFictionalMatchSetup()
  const original = createFoundationMatch(setup).getState()
  const home = setup.clubs[0].id
  const passer = original.players.find(p =>
    p.clubId===home && p.formationSlot==='DM')!
  const receiver = original.players.find(p =>
    p.clubId===home && p.formationSlot==='RCM')!
  const striker = original.players.find(p =>
    p.clubId===home && p.formationSlot==='ST')!
  const players=original.players.map(p=>{
    const position = p.playerId===passer.playerId
      ? {xM:65,yM:34} :
      p.playerId===receiver.playerId ? reception :
      p.playerId===striker.playerId ? runnerPosition :
      p.clubId!==home
        ? p.formationSlot==='GK' ? {xM:102,yM:34}
          : {xM:51,yM:p.position.yM<34?8:60}
        : p.position
    return {...p,position,velocity:{xMps:0,yMps:0}}
  })
  const state:MatchState={...original,kickoff:null,players,
    ball:{...original.ball,position:{xM:65,yM:34},
      controllerId:passer.playerId,controlOffset:{xM:0,yM:0},
      lastTouchPlayerId:passer.playerId},
    ai:{...original.ai,enabledTeams:[true,true]},
  }
  const atReceiver=players.find(p=>p.playerId===receiver.playerId)!
  const defenderStates=players.filter(p=>p.clubId!==home)
  const team=state.teams.find(t=>t.clubId===home)!
  const teammates=players.filter(p=>p.clubId===home)
  const definition=setup.players.find(p=>p.id===receiver.playerId)!
  return {setup,state,team,passer,receiver:atReceiver,
    striker:players.find(p=>p.playerId===striker.playerId)!,
    teammates,defenderStates,definition}
}

describe('Phase 6.9H: prospective next action after a physically viable pass',()=>{
  it('identifies a genuine forward second-pass option without creating it',()=>{
    const {setup,state,team,passer,receiver,striker,definition,
      teammates,defenderStates}=stage()
    const before=JSON.stringify(state)
    const continuation=evaluateReceiverContinuation(receiver,definition,
      receiver.position,passer.playerId,team,setup,
      teammates,defenderStates)
    expect(continuation.kind).toBe('combine')
    expect(continuation.potentialReceiverId).toBe(striker.playerId)
    expect(continuation.adjustment).toBeGreaterThan(0)
    expect(continuation.adjustment).toBeLessThanOrEqual(MAX_CONTINUATION_ADJUSTMENT)
    expect(JSON.stringify(state)).toBe(before)
    expect(state.contactEvents).toHaveLength(0)
    expect(state.goalEvents).toHaveLength(0)
    expect(evaluateReceiverContinuation(receiver,definition,
      receiver.position,passer.playerId,team,setup,teammates,
      defenderStates)).toEqual(continuation)
  })
  it('recognizes a receiving striker with a physically plausible shooting corridor',()=>{
    const {setup,state,team,passer,teammates,
      defenderStates}=stage({xM:88,yM:34},{xM:76,yM:20})
    const striker=teammates.find(p=>p.formationSlot==='ST')!
    const strikerDefinition=setup.players.find(p=>p.id===striker.playerId)!
    const received=evaluateReceiverContinuation(striker,strikerDefinition,
      {xM:88,yM:34},passer.playerId,team,setup,teammates,defenderStates)
    expect(received.kind).toBe('shoot')
    expect(received.adjustment).toBeGreaterThan(0)
    expect(state.contactEvents).toHaveLength(0)
  })
  it('does not reward an immediately crowded receiving situation',()=>{
    const {setup,team,passer,receiver,definition,teammates,
      defenderStates}=stage()
    const crowded=defenderStates.map((p,i)=>({...p,position:i===0
      ? {xM:76.4,yM:34.1} : p.position}))
    const forecast=evaluateReceiverContinuation(receiver,definition,
      receiver.position,passer.playerId,team,setup,teammates,crowded)
    expect(forecast.kind).toBe('protect')
    expect(forecast.adjustment).toBeLessThan(0)
  })
  it('does not invent a high-value forward option too far from goal',()=>{
    const {setup,team,passer,receiver,definition,
      teammates,defenderStates}=stage()
    const distant=evaluateReceiverContinuation(receiver,definition,
      {xM:48,yM:34},passer.playerId,team,setup,
      teammates,defenderStates)
    expect(distant.kind).toBe('protect')
    expect(distant.adjustment).toBe(0)
  })
  it('makes actual pass utility depend on the third player\'s position',()=>{
    const a=stage({xM:76,yM:34},{xM:88,yM:34})
    const b=stage({xM:76,yM:34},{xM:44,yM:59})
    const option={kind:'pass' as const,receiverId:a.receiver.playerId,
      target:{xM:76,yM:34},power:.43,lift:0,utility:30}
    const withRun=reviewOnBallActions(a.state,a.setup,[option])
    const withoutRun=reviewOnBallActions(b.state,b.setup,[option])
    expect(withRun.assessments[0].utility)
      .toBeGreaterThan(withoutRun.assessments[0].utility)
    expect(withRun.assessments[0].reasons)
      .toContain('Receiver can combine with an open advanced teammate')
    expect(a.state.contactEvents).toHaveLength(0)
    expect(b.state.contactEvents).toHaveLength(0)
  })
  it('does not overvalue a teammate\'s hypothetical next action over a clear shot',()=>{
    const staged=stage({xM:94,yM:34},{xM:88,yM:34})
    const owner=staged.striker
    const state:MatchState={...staged.state,
      ball:{...staged.state.ball,
        position:owner.position,
        controllerId:owner.playerId,lastTouchPlayerId:owner.playerId}}
    const pass={kind:'pass' as const,receiverId:staged.receiver.playerId,
      target:{xM:94,yM:34},power:.35,lift:0,utility:32}
    const reviewed=reviewOnBallActions(state,staged.setup,[pass])
    expect(reviewed.assessments[0].reasons)
      .toContain('Current ball carrier has an immediate shooting lane')
    expect(state.contactEvents).toHaveLength(0)
    expect(state.goalEvents).toHaveLength(0)
  })
  it('keeps exact replay checks and kickoff protection unchanged',()=>{
    const session=new MatchViewerSession(90)
    for(let i=0;i<120 && !session.state.ball.outsidePitch;i++)
      session.advance(6)
    const saved=session.checkpoint()
    const restored=restoreFoundationMatch(saved)
    session.advance(4)
    restored.advance(4)
    expect(restored.checkpoint()).toEqual(session.checkpoint())
  })
})
