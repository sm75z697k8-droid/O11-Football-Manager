import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { evaluateOnBallPlan } from '../../src/game/ai/possession'
import {
  evaluateShootingOpportunity, shootingCorridorObstruction,
} from '../../src/game/ai/goal-directed'
import { reviewOnBallActions } from '../../src/game/ai/short-horizon'
import { evaluatePhysicalShotWindows } from '../../src/game/ai/shot-window'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import type { MatchState } from '../../src/game/match/state'
import type { MatchSetup } from '../../src/game/model/match'

function stage(side: 0|1, opts?:{
  keeperY?: number; blocked?: boolean; pressured?: boolean;
  shooterX?: number;
}) {
  const setup=makeFictionalMatchSetup()
  const original=createFoundationMatch(setup).getState()
  const team=original.teams[side]
  const forward=team.attackingDirection
  const striker=original.players.find(p=>
    p.clubId===team.clubId && p.formationSlot==='ST')!
  const dm=original.players.find(p=>
    p.clubId===team.clubId && p.formationSlot==='DM')!
  const opponentClub=original.teams[1-side].clubId
  const goalkeeper=original.players.find(p=>
    p.clubId===opponentClub&&p.formationSlot==='GK')!
  const centerX=opts?.shooterX??(side===0?92:13)
  let blockerFound=false
  const players=original.players.map(p=>{
    let point=p.position
    if(p.playerId===striker.playerId)point={xM:centerX,yM:34}
    else if(p.playerId===dm.playerId)point={
      xM:centerX-forward*10,yM:30,
    }
    else if(p.playerId===goalkeeper.playerId)point={
      xM:side===0?102:3,yM:opts?.keeperY??34,
    }
    else if(p.clubId===opponentClub){
      const blocker=(opts?.blocked||opts?.pressured)&&
        !blockerFound && p.formationSlot==='RCB'
      if(blocker){
        blockerFound=true
        point={xM:centerX+forward*(opts?.pressured?1.9:4.5),
          yM:34}
      }else point={xM:side===0?51:54,yM:p.position.yM<34?8:60}
    }
    return {...p,position:point,orientationRad:p.playerId===striker.playerId
      ? (forward===1?0:Math.PI) : p.orientationRad,
      velocity:{xMps:0,yMps:0}}
  })
  const state:MatchState={
    ...original,kickoff:null,clock:{...original.clock,tick:120},
    players,
    ball:{...original.ball,
      position:{xM:centerX,yM:34},heightM:.11,
      velocity:{xMps:0,yMps:0,zMps:0},
      outsidePitch:false,
      controllerId:striker.playerId,
      controlOffset:{xM:0,yM:0},
      lastTouchPlayerId:striker.playerId},
    ai:{...original.ai,enabledTeams:[true,true],lastPassTick:-1000},
  }
  const shooter=players.find(p=>p.playerId===striker.playerId)!
  const def=setup.players.find(p=>p.id===shooter.playerId)!
  const opponents=players.filter(p=>p.clubId===opponentClub)
  return {setup,state,team,shooter,def,opponents,dm}
}

function skillSetup(
  setup:MatchSetup, id:string, value:number,
):MatchSetup {
  return {...setup,players:setup.players.map(p=>p.id!==id?p:{
    ...p,abilities:{
      ...p.abilities,
      technical:{...p.abilities.technical,
        finishing:value,longShots:value,technique:value},
      mental:{...p.abilities.mental,composure:value},
    },
  })}
}

describe('Phase 6.9M — decisions and physical shot-frame preview',()=>{
  for(const side of [0,1] as const) {
    it(`recognizes an immediate central shot before wasting possession backward from goal ${side}`,()=>{
      const a=stage(side)
      const before=JSON.stringify(a.state)
      const shot=evaluateShootingOpportunity(
        a.shooter,a.def,a.opponents,a.team,a.setup)
      expect(shot).not.toBeNull()
      expect(shot!.onFrameShare).toBeGreaterThan(.55)
      expect(shootingCorridorObstruction(
        a.shooter.position,shot!.target,a.opponents)).toBeLessThan(1.8)
      const plan=evaluateOnBallPlan(a.state,a.setup,true,true)
      expect(plan.choice?.kind).toBe('shoot')
      expect(plan.choice?.kind==='shoot'&&
        plan.choice.target.xM).toBe(side===0?105:0)
      expect(JSON.stringify(a.state)).toBe(before)
      expect(a.state.contactEvents).toHaveLength(0)
      expect(a.state.goalEvents).toHaveLength(0)
    })

    it(`executes the chosen shot using genuine seeded kicking physics from goal ${side}`,()=>{
      const a=stage(side)
      const choice=evaluateOnBallPlan(a.state,a.setup,true,true).choice
      expect(choice?.kind).toBe('shoot')
      if(!choice||choice.kind!=='shoot')return
      const command={
        commandId:'ai-shot-p69m-physics-'+side,
        type:'attemptKick' as const,
        teamId:a.team.clubId,playerId:a.shooter.playerId,
        target:choice.target,power:choice.power,lift:choice.lift,
        requestedTick:119,targetTick:120,appliedTick:120,sequence:1,
      }
      const input:MatchState={...a.state,appliedCommands:[command]}
      const raw=JSON.stringify(input)
      const after=resolveContactAttempts(input,a.setup)
      expect(after.contactEvents.at(-1)?.outcome).toBe('kicked')
      expect(after.ball.controllerId).toBeNull()
      expect(after.ball.lastTouchPlayerId).toBe(a.shooter.playerId)
      expect(after.ball.velocity.xMps*a.team.attackingDirection)
        .toBeGreaterThan(0)
      expect(after.ball.velocity.zMps).toBeGreaterThan(0)
      expect(after.goalEvents).toHaveLength(0)
      expect(JSON.stringify(input)).toBe(raw)
    })
  }

  it('prefers the goal side not already guarded by the goalkeeper',()=>{
    const high=stage(0,{keeperY:39})
    const low=stage(0,{keeperY:29})
    const shotHigh=evaluateShootingOpportunity(
      high.shooter,high.def,high.opponents,high.team,high.setup)!
    const shotLow=evaluateShootingOpportunity(
      low.shooter,low.def,low.opponents,low.team,low.setup)!
    expect(shotHigh.target.yM).toBeLessThan(34)
    expect(shotLow.target.yM).toBeGreaterThan(34)
  })

  it('models less accurate finishers with larger frame-miss exposure at distance',()=>{
    const a=stage(0,{shooterX:81})
    const poor=skillSetup(a.setup,a.shooter.playerId,12)
    const elite=skillSetup(a.setup,a.shooter.playerId,96)
    const poorDef=poor.players.find(p=>p.id===a.shooter.playerId)!
    const eliteDef=elite.players.find(p=>p.id===a.shooter.playerId)!
    const cheap=evaluatePhysicalShotWindows(
      a.shooter,poorDef,a.opponents,a.team,poor,.94,.12)
    const best=evaluatePhysicalShotWindows(
      a.shooter,eliteDef,a.opponents,a.team,elite,.94,.12)
    expect(best[0].onFrameShare).toBeGreaterThanOrEqual(cheap[0].onFrameShare)
    expect(best[0].onFrameShare).toBeGreaterThan(0)
    expect(cheap[0].onFrameShare).toBeLessThan(1)
    expect(JSON.stringify(a.state)).toContain(a.shooter.playerId)
  })

  it('charges back-passes for surrendering a credible unpressured current shot',()=>{
    const open=stage(0)
    const blocked=stage(0,{blocked:true})
    const receiver=open.state.players.find(p=>p.playerId===open.dm.playerId)!
    const pass={kind:'pass' as const,
      receiverId:receiver.playerId,target:{...receiver.position},
      power:.42,lift:0,utility:60}
    const openReview=reviewOnBallActions(open.state,open.setup,[pass])
    const blockedReview=reviewOnBallActions(blocked.state,blocked.setup,[pass])
    expect(openReview.assessments[0].reasons)
      .toContain('Backward pass wastes a credible immediate shooting window')
    expect(blockedReview.assessments[0].reasons)
      .not.toContain('Backward pass wastes a credible immediate shooting window')
    expect(blockedReview.assessments[0].utility)
      .toBeGreaterThan(openReview.assessments[0].utility)
  })

  it('does not treat all pass options as wasteful when shooting is blocked',()=>{
    const a=stage(0,{blocked:true})
    const shot=evaluateShootingOpportunity(
      a.shooter,a.def,a.opponents,a.team,a.setup)
    const open=stage(0)
    const originalShot=evaluateShootingOpportunity(
      open.shooter,open.def,open.opponents,open.team,open.setup)
    expect(shot).not.toBeNull()
    expect(shot!.utility).toBeLessThan(originalShot!.utility)
    // A better teammate remains a permissible action; no shot override.
    const plan=evaluateOnBallPlan(a.state,a.setup,true,false)
    expect(['pass','carry','shoot']).toContain(plan.choice?.kind)
    expect(a.state.contactEvents).toHaveLength(0)
  })
})
