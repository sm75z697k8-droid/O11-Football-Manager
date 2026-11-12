import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { planThirdManRun } from '../../src/game/ai/combination-runs'
import { chooseDynamicSupport } from '../../src/game/ai/support-space'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import type { MatchState } from '../../src/game/match/state'

function stagedPass() {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const team = setup.clubs[0].id
  const passer = initial.players.find(p => p.clubId === team && p.formationSlot === 'DM')!
  const receiver = initial.players.find(p => p.clubId === team && p.formationSlot === 'RCM')!
  const striker = initial.players.find(p => p.clubId === team && p.formationSlot === 'ST')!
  const players = initial.players.map(p => {
    const position = p.playerId === passer.playerId ? {xM:64,yM:34} :
      p.playerId === receiver.playerId ? {xM:76,yM:34} :
      p.playerId === striker.playerId ? {xM:80,yM:34} :
      p.clubId !== team ? (p.formationSlot === 'GK'
        ? {xM:101,yM:34} : {xM:95,yM:p.position.yM < 34 ? 9 : 59}) :
      p.position
    return {...p,position,velocity:{xMps:0,yMps:0},engagesBall:false}
  })
  const commandId='ai-pass-21-'+passer.playerId
  const intent={
    commandId,teamId:team,passerId:passer.playerId,
    receiverId:receiver.playerId,requestedTick:21,target:{xM:76,yM:34},
  }
  const state:MatchState={...initial,clock:{...initial.clock,tick:24},
    kickoff:null,players,
    ai:{...initial.ai,enabledTeams:[true,true],lastDecisionTick:23,passIntent:intent},
    ball:{...initial.ball,position:{xM:74,yM:34},heightM:.11,
      velocity:{xMps:4,yMps:0,zMps:0},
      controllerId:null,controlOffset:null,lastTouchPlayerId:passer.playerId},
    contactEvents:[{commandId,playerId:passer.playerId,tick:22,
      kind:'kick',outcome:'kicked',drawUsed:1}],
  }
  return {setup,state,team,passer,receiver,striker}
}

describe('Phase 6.9G physically coordinated third-man movement',()=>{
  it('nominates a separate striker after a real kick, without awarding a reception',()=>{
    const {setup,state,team,passer,receiver,striker}=stagedPass()
    const original=JSON.stringify(state)
    const planned=planThirdManRun(state,setup,team)
    expect(planned).not.toBeNull()
    expect(planned!.playerId).toBe(striker.playerId)
    expect(planned!.playerId).not.toBe(receiver.playerId)
    expect(planned!.playerId).not.toBe(passer.playerId)
    const liveReceiver = state.players.find(p=>p.playerId===receiver.playerId)!
    expect(planned!.target.xM).toBeGreaterThan(liveReceiver.position.xM)
    expect(Math.hypot(planned!.target.xM-striker.position.xM,
      planned!.target.yM-striker.position.yM)).toBeLessThanOrEqual(18)
    const support=chooseDynamicSupport(state,setup,team,
      liveReceiver.position,new Set([receiver.playerId]))
    expect(support.get(striker.playerId)?.target).toEqual(planned!.target)
    expect(support.get(striker.playerId)?.utility).toBeGreaterThan(0)
    expect(state.ball.controllerId).toBeNull()
    expect(state.automaticContactEvents).toHaveLength(0)
    expect(state.contactEvents).toHaveLength(1)
    expect(JSON.stringify(state)).toBe(original)
    expect(planThirdManRun(state,setup,team)).toEqual(planned)
  })
  it('a queued or failed pass must not mobilize a speculative third man',()=>{
    const {setup,state,team}=stagedPass()
    expect(planThirdManRun({...state,contactEvents:[]},setup,team)).toBeNull()
    const failed:MatchState={...state,contactEvents:state.contactEvents.map(e=>({
      ...e,outcome:'outOfReach' as const,drawUsed:0 as const,
    }))}
    expect(planThirdManRun(failed,setup,team)).toBeNull()
  })
  it('terminates a run when the pass is touched or owned or expired',()=>{
    const {setup,state,team,receiver}=stagedPass()
    const touched:MatchState={...state,ball:{...state.ball,
      lastTouchPlayerId:receiver.playerId}}
    expect(planThirdManRun(touched,setup,team)).toBeNull()
    const controlled:MatchState={...state,ball:{...state.ball,
      controllerId:receiver.playerId}}
    expect(planThirdManRun(controlled,setup,team)).toBeNull()
    const old:MatchState={...state,clock:{...state.clock,tick:50}}
    expect(planThirdManRun(old,setup,team)).toBeNull()
  })
  it('never creates a combination outside the attacking third or for the wrong team',()=>{
    const {setup,state,team}=stagedPass()
    const deep:MatchState={...state,ball:{...state.ball,position:{xM:30,yM:34}}}
    // The old receiving target remains midfield, not an attacking third-man run.
    const moved:MatchState={...deep,players:deep.players.map(p=>
      p.playerId===state.ai.passIntent?.receiverId ?
        {...p,position:{xM:42,yM:34}} : p)}
    expect(planThirdManRun(moved,setup,team)).toBeNull()
    expect(planThirdManRun(state,setup,setup.clubs[1].id)).toBeNull()
  })
  it('assigns third-man support without stealing the intended receiver\'s ball engagement',()=>{
    const {setup,state,receiver,striker}=stagedPass()
    const snapshots=planTeamDecisions(state,setup)
    const third=snapshots.find(d=>d.playerId===striker.playerId)!
    const receiving=snapshots.find(d=>d.playerId===receiver.playerId)!
    expect(third.action).toBe('support')
    expect(third.engage).toBe(false)
    expect(receiving.action).toBe('receive')
    expect(receiving.engage).toBe(true)
    expect(third.target.xM).toBeGreaterThan(
      state.players.find(p=>p.playerId===receiver.playerId)!.position.xM)
  })
  it('preserves deterministic headless match checkpoints',()=>{
    const session=new MatchViewerSession(90)
    for(let i=0;i<150 && !session.state.ball.outsidePitch;i++)session.advance(6)
    const cp=session.checkpoint()
    const clone=restoreFoundationMatch(cp)
    session.advance(4)
    clone.advance(4)
    expect(clone.checkpoint()).toEqual(session.checkpoint())
  })
})
