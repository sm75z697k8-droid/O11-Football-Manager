import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { planCoordinatedAttack } from '../../src/game/ai/attack-coordination'
import { chooseDynamicSupport } from '../../src/game/ai/support-space'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { separationM } from '../../src/game/ai/coordination'
import type { MatchState } from '../../src/game/match/state'
import type { Point2 } from '../../src/game/model/pitch'
import { MatchViewerSession } from '../../src/game/viewer/session'

function scenario(direction:1|-1=1,carrierSlot='DM'){
  const setup=makeFictionalMatchSetup()
  const initial=createFoundationMatch(setup).getState()
  const team=initial.teams.find(t=>t.attackingDirection===direction)!
  const opponents=initial.teams.find(t=>t.clubId!==team.clubId)!
  const x=(v:number)=>direction===1?v:setup.pitch.lengthM-v
  const carrier=initial.players.find(p=>p.clubId===team.clubId &&
    p.formationSlot===carrierSlot)!
  const centre=setup.pitch.widthM/2
  const locs:Readonly<Record<string,readonly [number,number]>>={
    GK:[5,0],RB:[58,25],RCB:[52,12],LCB:[52,-12],LB:[58,-25],
    DM:[63,0],RCM:[73,11],LCM:[73,-11],
    RW:[78,18],ST:[80,0],LW:[78,-18],
  }
  const reference:Point2={xM:x(72),yM:centre}
  const players=initial.players.map(p=>{
    if(p.clubId===team.clubId){
      const [nx,ny]=locs[p.formationSlot]
      return {...p,position:p.playerId===carrier.playerId?reference:
        {xM:x(nx),yM:centre+(ny===0?0:Math.sign(ny)*Math.abs(ny)*direction)},
        velocity:{xMps:0,yMps:0}}
    }
    // A realistic defensive line: the real carrier has room to see a
    // winger and midfielder run, but the physical goalkeeper stays home.
    return {...p,position:p.formationSlot==='GK'
      ? {xM:x(104),yM:centre}
      : {xM:x(94),yM:6+(p.shirtNumber%9)*6.3},
      velocity:{xMps:0,yMps:0}}
  })
  const state:MatchState={...initial,clock:{...initial.clock,tick:220},
    kickoff:null,players,
    ai:{...initial.ai,enabledTeams:[true,true]},
    ball:{...initial.ball,position:reference,controllerId:carrier.playerId,
      lastTouchPlayerId:carrier.playerId,
      controlOffset:{xM:0,yM:0},heightM:.11},
  }
  return {setup,state,team,opponents,carrier,reference}
}
describe('ATT-S1: coordinated non-striker attacking contributions',()=>{
  for(const direction of [1,-1] as const){
    it('assigns independent winger and midfielder runs on both directions '+direction,()=>{
      const {setup,state,team,carrier,reference}=scenario(direction)
      const before=JSON.stringify(state)
      const plan=planCoordinatedAttack(state,setup,team.clubId)
      const runs=[...plan.values()]
      expect(runs.some(r=>r.role==='insideForward')).toBe(true)
      expect(runs.some(r=>r.role==='midfieldArrival')).toBe(true)
      expect(runs.filter(r=>['insideForward','midfieldArrival',
        'strikerLink'].includes(r.role)).length).toBeLessThanOrEqual(3)
      for(const run of runs){
        const runner=state.players.find(p=>p.playerId===run.playerId)!
        expect(runner.playerId).not.toBe(carrier.playerId)
        expect(['GK','DM','RCB','LCB']).not.toContain(runner.formationSlot)
        expect(separationM(runner.position,run.target)).toBeGreaterThan(2.2)
        expect(separationM(runner.position,run.target)).toBeLessThanOrEqual(18.01)
        expect(run.clearanceM).toBeGreaterThanOrEqual(4.4)
        const opponents=state.players.filter(p=>p.clubId!==team.clubId)
        const ceiling=Math.max(reference.xM*direction,
          opponents.map(p=>p.position.xM*direction)
            .sort((a,b)=>b-a)[1])-.7
        expect(run.target.xM*direction).toBeLessThanOrEqual(ceiling+.001)
      }
      for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++)
        expect(separationM(runs[i].target,runs[j].target))
          .toBeGreaterThanOrEqual(6.3)
      expect(JSON.stringify(state)).toBe(before)
      expect(planCoordinatedAttack(state,setup,team.clubId)).toEqual(plan)
    })
    it('integrates live coordinated targets without assigning a pass or goal '+direction,()=>{
      const {setup,state,team,carrier,reference}=scenario(direction)
      const planned=planCoordinatedAttack(state,setup,team.clubId)
      const support=chooseDynamicSupport(state,setup,team.clubId,
        reference,new Set([carrier.playerId]))
      const snapshot=planTeamDecisions(state,setup)
      const roleRuns=[...planned.values()].filter(r=>
        r.role==='insideForward'||r.role==='midfieldArrival')
      expect(roleRuns.length).toBeGreaterThanOrEqual(2)
      for(const run of roleRuns){
        const chosen=support.get(run.playerId)
        expect(chosen?.target).toEqual(run.target)
        const decision=snapshot.find(d=>d.playerId===run.playerId)!
        expect(decision.action).toBe('support')
        expect(decision.engage).toBe(false)
        expect(decision.target).toEqual(run.target)
      }
      expect(state.ball.controllerId).toBe(carrier.playerId)
      expect(state.contactEvents).toHaveLength(0)
      expect(state.goalEvents).toHaveLength(0)
    })
    it('does not launch fake attacking runs when possession is lost or ball dead '+direction,()=>{
      const {setup,state,team,opponents}=scenario(direction)
      const defender=state.players.find(p=>p.clubId===opponents.clubId)!
      const lost:MatchState={...state,ball:{...state.ball,
        lastTouchPlayerId:defender.playerId,
        controllerId:defender.playerId}}
      expect(planCoordinatedAttack(lost,setup,team.clubId).size).toBe(0)
      expect(planCoordinatedAttack({...state,
        ball:{...state.ball,outsidePitch:true}},
        setup,team.clubId).size).toBe(0)
      expect(planCoordinatedAttack({...state,
        ball:{...state.ball,heightM:1.3}},
        setup,team.clubId).size).toBe(0)
    })
  }
  it('respects a committed receiver and preserves rest defence',()=>{
    const {setup,state,team,carrier}=scenario()
    const wingers=state.players.filter(p=>p.clubId===team.clubId &&
      (p.formationSlot==='RW'||p.formationSlot==='LW'))
    const receiver=wingers[0]
    const plan=planCoordinatedAttack(state,setup,team.clubId,
      new Set([receiver.playerId]))
    expect(plan.has(receiver.playerId)).toBe(false)
    expect(plan.has(carrier.playerId)).toBe(false)
    const selected=chooseDynamicSupport(state,setup,team.clubId,
      carrier.position,new Set([carrier.playerId,receiver.playerId]))
    expect(selected.has(receiver.playerId)).toBe(false)
    for(const slot of ['DM','RCB','LCB']){
      const p=state.players.find(p=>p.clubId===team.clubId &&
        p.formationSlot===slot)!
      expect(plan.has(p.playerId)).toBe(false)
    }
  })
  it('rejects a genuinely blocked destination instead of forcing a winger run',()=>{
    const {setup,state,team}=scenario()
    const clear=planCoordinatedAttack(state,setup,team.clubId)
    const inside=[...clear.values()].find(p=>p.role==='insideForward')!
    expect(inside).toBeDefined()
    const opponent=state.players.find(p=>p.clubId!==team.clubId &&
      p.formationSlot==='RCB')!
    const blocked:MatchState={...state,players:state.players.map(p=>
      p.playerId===opponent.playerId
        ? {...p,position:inside.target}:p)}
    const changed=planCoordinatedAttack(blocked,setup,team.clubId)
    const same=changed.get(inside.playerId)
    expect(same?.target).not.toEqual(inside.target)
    for(const run of changed.values())
      expect(separationM(run.target,inside.target)).toBeGreaterThanOrEqual(
        run.playerId===inside.playerId?2:0)
  })
  it('respects relative player abilities rather than automatically choosing a fixed midfielder',()=>{
    const {setup,state,team,carrier}=scenario()
    const mids=state.players.filter(p=>p.clubId===team.clubId &&
      ['RCM','LCM'].includes(p.formationSlot))
    const reserved=new Set(state.players.filter(p=>
      p.clubId===team.clubId &&
      !['RCM','LCM'].includes(p.formationSlot)).map(p=>p.playerId))
    reserved.delete(carrier.playerId)
    const stronger=mids[0],weaker=mids[1]
    const altered={...setup,players:setup.players.map(p=>
      p.id===stronger.playerId?{...p,abilities:{...p.abilities,
        mental:{...p.abilities.mental,offTheBall:97,
          anticipation:97,decisions:97,teamwork:97}}}:
      p.id===weaker.playerId?{...p,abilities:{...p.abilities,
        mental:{...p.abilities.mental,offTheBall:10,
          anticipation:10,decisions:10,teamwork:10}}}:p)}
    const run=planCoordinatedAttack(state,altered,team.clubId,reserved)
    expect([...run.values()].find(p=>p.role==='midfieldArrival')?.playerId)
      .toBe(stronger.playerId)
  })
  it('retains deterministic checkpoint replay with the new movement selection',()=>{
    const session=new MatchViewerSession(90)
    for(let i=0;i<240&&!session.state.ball.outsidePitch;i++)
      session.advance(4)
    const restored=restoreFoundationMatch(session.checkpoint())
    session.advance(12);restored.advance(12)
    expect(restored.checkpoint()).toEqual(session.checkpoint())
  })
})
