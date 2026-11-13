import {describe,expect,it} from 'vitest'
import {makeFictionalMatchSetup} from '../fixtures/fictional-match'
import {createFoundationMatch} from '../../src/game/match/engine'
import {recordOutOfPlay} from '../../src/game/match/restarts'
import {applyDueMatchCommands} from '../../src/game/match/commands'
import {resolveContactAttempts} from '../../src/game/physics/contact'
import {
  goalKickSpot,goalKickReceiverTargets,stageGoalKick,
  advanceGoalKickStoppage,insideRestartPenaltyArea,
} from '../../src/game/match/goal-kicks'
import {
  goalKickBuildOutTarget,goalKickOpponentTarget,
  assessGoalKickOptions,chooseGoalKickOption,
} from '../../src/game/match/goal-kick-intelligence'
import type {MatchState,PlayerMatchState} from '../../src/game/match/state'

function scene(side:'left'|'right',staged=false) {
  const setup=makeFictionalMatchSetup()
  const original=createFoundationMatch(setup).getState()
  const defending=side==='left'?original.teams[0]:original.teams[1]
  const direction:1|-1=side==='left'?1:-1
  const goalX=side==='left'?0:setup.pitch.lengthM
  const last=original.players.find(p=>p.clubId!==defending.clubId &&
    p.formationSlot==='ST')!
  const before:MatchState={...original,clock:{...original.clock,tick:100},
    ball:{...original.ball,position:{xM:goalX+direction*.06,yM:29},
      velocity:{xMps:-direction*11,yMps:0,zMps:0},
      lastTouchPlayerId:last.playerId,outsidePitch:false}}
  const after:MatchState={...before,clock:{...before.clock,tick:101},
    ball:{...before.ball,position:{xM:goalX-direction*.19,yM:29},
      outsidePitch:true}}
  const awarded=recordOutOfPlay(before,after,setup)
  const event=awarded.restart!
  const spot=goalKickSpot(event,setup.pitch)
  const cb=goalKickReceiverTargets(event,setup)
  const keeper=awarded.players.find(p=>p.clubId===defending.clubId &&
    p.formationSlot==='GK')!
  const players=awarded.players.map(p=>{
    if(!staged)return p
    if(p.playerId===keeper.playerId)return {...p,
      position:{xM:spot.xM-direction*.6,yM:spot.yM},
      orientationRad:direction===1?0:Math.PI,
      velocity:{xMps:0,yMps:0}}
    if(p.clubId===defending.clubId && ['RCB','LCB'].includes(p.formationSlot))
      return {...p,position:cb[p.formationSlot==='RCB'?0:1],
        velocity:{xMps:0,yMps:0}}
    if(p.clubId!==defending.clubId &&
      insideRestartPenaltyArea(p.position,event,setup.pitch))
      return {...p,position:{xM:goalX+direction*19,yM:p.position.yM},
        velocity:{xMps:0,yMps:0}}
    return p
  })
  const state:MatchState={...awarded,
    clock:{...awarded.clock,tick:staged?131:101},
    ai:{...awarded.ai,enabledTeams:[true,true]},
    players}
  return {setup,state,event,spot,defending,keeper,dir:direction}
}
function place(
  state:MatchState,
  predicate:(p:PlayerMatchState)=>boolean,
  change:(p:PlayerMatchState)=>PlayerMatchState,
):MatchState {
  return {...state,players:state.players.map(p=>predicate(p)?change(p):p)}
}

describe('GK-S1 realistic goal-kick approach and build-out',()=>{
  for(const side of ['left','right'] as const){
    it('approaches from BEHIND the ball, not from in front, '+side,()=>{
      const s=scene(side,true)
      const inFront=place(s.state,p=>p.playerId===s.keeper.playerId,
        p=>({...p,position:{xM:s.spot.xM+s.dir*.45,yM:s.spot.yM},
          velocity:{xMps:0,yMps:0},
          orientationRad:s.dir===1?0:Math.PI}))
      const before=JSON.stringify(inFront)
      const planned=stageGoalKick(inFront,s.setup)
      const k=planned.players.find(p=>p.playerId===s.keeper.playerId)!
      expect(k.intention.kind).toBe('moveToPoint')
      if(k.intention.kind==='moveToPoint')
        expect((k.intention.target.xM-s.spot.xM)*s.dir).toBeLessThan(-.5)
      expect(planned.pendingCommands.some(p=>p.type==='attemptGoalKick')).toBe(false)
      expect(planned.ball.position).toEqual(inFront.ball.position)
      expect(JSON.stringify(inFront)).toBe(before)
    })
    it('refuses a goal kick while keeper has wrong facing even if within foot reach, '+side,()=>{
      const s=scene(side,true)
      const wrong=place(s.state,p=>p.playerId===s.keeper.playerId,
        p=>({...p,orientationRad:s.dir===1?Math.PI:0}))
      const result=stageGoalKick(wrong,s.setup)
      expect(result.pendingCommands.some(p=>p.type==='attemptGoalKick')).toBe(false)
      expect(stageGoalKick(s.state,s.setup).pendingCommands.some(p=>
        p.type==='attemptGoalKick')).toBe(true)
    })
    it('organizes outfield outlets and a legal pressing screen without teleporting, '+side,()=>{
      const s=scene(side,false)
      const prior=JSON.stringify(s.state)
      const ready=stageGoalKick(s.state,s.setup)
      for(const slot of ['RB','LB','DM','RCM','LCM','RW','LW','ST']){
        const p=s.state.players.find(p=>p.clubId===s.defending.clubId &&
          p.formationSlot===slot)!
        const assigned=ready.players.find(q=>q.playerId===p.playerId)!
        expect(assigned.position).toEqual(p.position)
        expect(assigned.intention.kind).toBe('moveToPoint')
        if(assigned.intention.kind==='moveToPoint')
          expect(assigned.intention.target).toEqual(
            goalKickBuildOutTarget(p,s.event,s.setup))
      }
      const screen=s.state.players.find(p=>
        p.clubId!==s.defending.clubId&&p.formationSlot==='ST')!
      const target=goalKickOpponentTarget(screen,s.event,s.setup,'high')
      expect(insideRestartPenaltyArea(target,s.event,s.setup.pitch)).toBe(false)
      const highPress=(index:0|1)=>s.state.teams[index].clubId===
        s.defending.clubId?s.state.teams[index]:
          {...s.state.teams[index],pressingIntensity:'high' as const}
      const rivalHigh:MatchState={...s.state,
        teams:[highPress(0),highPress(1)]}
      const withPress=stageGoalKick(rivalHigh,s.setup)
      const screened=withPress.players.find(p=>p.playerId===screen.playerId)!
      expect(screened.intention.kind).toBe('moveToPoint')
      if(screened.intention.kind==='moveToPoint')
        expect(insideRestartPenaltyArea(screened.intention.target,
          s.event,s.setup.pitch)).toBe(false)
      expect(JSON.stringify(s.state)).toBe(prior)
    })
    it('completes a REAL goal kick from unstaged goalkeeper/defender positions '+side,()=>{
      const s=scene(side,false)
      let current=s.state
      let kicked=false
      for(let i=0;i<700;i++){
        const due=applyDueMatchCommands({...current,
          clock:{...current.clock,tick:current.clock.tick+1}})
        current=advanceGoalKickStoppage(due,s.setup,resolveContactAttempts)
        if(current.restart===null){kicked=true;break}
      }
      expect(kicked).toBe(true)
      expect(current.contactEvents.filter(c=>c.kind==='goalKick'&&
        c.outcome==='goalKicked')).toHaveLength(1)
      expect(current.ball.controllerId).toBeNull()
      expect(current.ball.lastTouchPlayerId).toBe(s.keeper.playerId)
      expect(current.ball.velocity.xMps*s.dir).toBeGreaterThan(0)
      expect(current.goalEvents).toHaveLength(0)
    })
  }

  it('chooses an OPEN full-back rather than kicking into a marked centre-back',()=>{
    const s=scene('left',true)
    const cbs=s.state.players.filter(p=>p.clubId===s.defending.clubId &&
      ['RCB','LCB'].includes(p.formationSlot))
    const op=s.state.players.filter(p=>p.clubId!==s.defending.clubId)
    const screen=place(s.state,p=>p.playerId===op[0].playerId||
      p.playerId===op[1].playerId,p=>{
        const cb=cbs[p.playerId===op[0].playerId?0:1]
        return {...p,position:{
          xM:s.setup.pitch.penaltyAreaDepthM+1,
          yM:cb.position.yM}}
      })
    const fb=screen.players.find(p=>p.clubId===s.defending.clubId&&
      p.formationSlot==='RB')!
    const fbTarget=goalKickBuildOutTarget(fb,s.event,s.setup)!
    const actual=place(screen,p=>p.playerId===fb.playerId,
      p=>({...p,position:fbTarget,velocity:{xMps:0,yMps:0}}))
    const staged=stageGoalKick(actual,s.setup)
    const command=staged.pendingCommands.find(c=>c.type==='attemptGoalKick')
    expect(command?.type).toBe('attemptGoalKick')
    expect(command?.lift).toBe(0)
    expect(staged.ai.passIntent?.receiverId).toBe(fb.playerId)
  })

  it('uses genuine lofted distribution when all playable short outlets are marked',()=>{
    const s=scene('right',true)
    const goalX=s.setup.pitch.lengthM
    const other=s.state.players.filter(p=>p.clubId!==s.defending.clubId)
    const targets=s.state.players.filter(p=>p.clubId===s.defending.clubId &&
      ['RCB','LCB','RB','LB','DM'].includes(p.formationSlot))
    const prepared=place(s.state,
      p=>p.clubId===s.defending.clubId &&
        ['RB','LB','DM'].includes(p.formationSlot),
      p=>({...p,position:goalKickBuildOutTarget(p,s.event,s.setup)!,
        velocity:{xMps:0,yMps:0}}))
    const marked=place(prepared,
      p=>p.playerId===other[0].playerId||
        p.playerId===other[1].playerId||
        p.playerId===other[2].playerId||
        p.playerId===other[3].playerId||
        p.playerId===other[4].playerId,
      p=>{
        const index=other.findIndex(q=>q.playerId===p.playerId)
        const receiver=targets[index]
        const loc=prepared.players.find(q=>q.playerId===receiver.playerId)!
        const inside=insideRestartPenaltyArea(loc.position,s.event,s.setup.pitch)
        return {...p,position:inside?{
          xM:goalX-s.setup.pitch.penaltyAreaDepthM-1.1,yM:loc.position.yM
        }:{...loc.position}}
      })
    const outcome=stageGoalKick(marked,s.setup)
    const kick=outcome.pendingCommands.find(c=>c.type==='attemptGoalKick')
    expect(kick?.type).toBe('attemptGoalKick')
    expect(kick?.lift).toBeGreaterThan(0)
    expect(['DM','RCM','LCM','RW','LW','ST']).toContain(
      marked.players.find(p=>p.playerId===outcome.ai.passIntent?.receiverId)
        ?.formationSlot)
  })

  it('assesses real positions deterministically without creating synthetic possession',()=>{
    const s=scene('left',true)
    const before=JSON.stringify(s.state)
    const cbs=s.state.players.filter(p=>p.clubId===s.defending.clubId &&
      ['RCB','LCB'].includes(p.formationSlot))
    const short=new Map(cbs.map((p,i)=>[p.playerId,
      goalKickReceiverTargets(s.event,s.setup)[i]]))
    const opts=assessGoalKickOptions(s.state,s.setup,s.event,s.spot,short)
    expect(opts.some(p=>p.type==='short')).toBe(true)
    expect(chooseGoalKickOption(opts,40)?.type).toBe('short')
    expect(opts).toEqual(assessGoalKickOptions(s.state,s.setup,s.event,s.spot,short))
    expect(s.state.ball.controllerId).toBeNull()
    expect(s.state.contactEvents).toHaveLength(0)
    expect(JSON.stringify(s.state)).toBe(before)
  })
})
