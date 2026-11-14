import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { AI_SHOT_MIN_INTERVAL_TICKS, AI_PASS_MIN_INTERVAL_TICKS, canReleaseControlledBall, evaluateOnBallPlan } from '../../src/game/ai/possession'
import { choosePossessionRelease } from '../../src/game/ai/decisions'
import {
  evaluateShootingOpportunity, shootingCorridorObstruction,
} from '../../src/game/ai/goal-directed'
import {
  reviewOnBallActions, opportunityCostOfDelayingShot,
} from '../../src/game/ai/short-horizon'
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

    it(`can shoot promptly after a legitimate recent pass, without reopening the rapid-pass loophole from goal ${side}`,()=>{
      const a=stage(side)
      const justReceived:MatchState={...a.state,
        ai:{...a.state.ai,lastPassTick:120-6}}
      expect(AI_PASS_MIN_INTERVAL_TICKS).toBeGreaterThan(
        AI_SHOT_MIN_INTERVAL_TICKS)
      expect(canReleaseControlledBall(justReceived,a.setup)).toBe(false)
      expect(canReleaseControlledBall(justReceived,a.setup,'shot')).toBe(true)
      const release=choosePossessionRelease(justReceived,a.setup)
      expect(release?.kind).toBe('shoot')
      expect(release?.playerId).toBe(a.shooter.playerId)
      const premature:MatchState={...justReceived,
        ai:{...justReceived.ai,lastPassTick:120-2}}
      expect(choosePossessionRelease(premature,a.setup)).toBeNull()
      expect(canReleaseControlledBall(premature,a.setup)).toBe(false)
      // A real first touch STILL requires the controlled ball to settle.
      const newContact:MatchState={...justReceived,
        automaticContactEvents:[{tick:119,playerId:a.shooter.playerId,
          outcome:'intercepted',kind:'interception',contactFraction:0}],
      }
      expect(canReleaseControlledBall(newContact,a.setup,'shot')).toBe(false)
      expect(choosePossessionRelease(newContact,a.setup)).toBeNull()
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

  it('favours an on-frame window away from the keeper rather than forcing corner shots',()=>{
    const high=stage(0,{keeperY:36})
    const low=stage(0,{keeperY:32})
    const shotHigh=evaluateShootingOpportunity(
      high.shooter,high.def,high.opponents,high.team,high.setup)!
    const shotLow=evaluateShootingOpportunity(
      low.shooter,low.def,low.opponents,low.team,low.setup)!
    // A central shot can be objectively safer than a far-corner shot
    // if the edge would be frequently missed by this specific striker.
    expect(shotHigh.target.yM).toBeLessThanOrEqual(34)
    expect(shotLow.target.yM).toBeGreaterThanOrEqual(34)
    const windows=evaluatePhysicalShotWindows(
      high.shooter,high.def,high.opponents,high.team,high.setup,
      shotHigh.power,shotHigh.lift)
    const away=windows.find(w=>w.target.yM<34)!
    const towards=windows.find(w=>w.target.yM>34)!
    expect(away.keeperGap).toBeGreaterThan(towards.keeperGap)
    expect(windows.every(w=>w.onFrameShare>=0&&w.onFrameShare<=1))
      .toBe(true)
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
      .toContain('Passing delays a credible immediate shooting window')
    expect(blockedReview.assessments[0].reasons)
      .not.toContain('Passing delays a credible immediate shooting window')
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
  // ATT-F1: a sideways pass that preserves possession but not shooting
  // quality should not automatically beat a clear physical finish.
  for(const side of [0,1] as const) {
    it(`recognizes sideways and minor-forward recycling as an immediate-shot cost on side ${side}`,()=>{
      const a=stage(side)
      const realShot=evaluateShootingOpportunity(
        a.shooter,a.def,a.opponents,a.team,a.setup)!
      expect(realShot).not.toBeNull()
      const dir=a.team.attackingDirection
      const sideways={xM:a.shooter.position.xM,yM:40}
      const forward={xM:a.shooter.position.xM+dir*3,yM:34}
      const backwards={xM:a.shooter.position.xM-dir*5,yM:34}
      const flankCost=opportunityCostOfDelayingShot(
        realShot,a.shooter,a.team,a.setup,a.opponents,sideways)
      const forwardCost=opportunityCostOfDelayingShot(
        realShot,a.shooter,a.team,a.setup,a.opponents,forward)
      const backwardsCost=opportunityCostOfDelayingShot(
        realShot,a.shooter,a.team,a.setup,a.opponents,backwards)
      expect(flankCost).toBeGreaterThan(3)
      expect(backwardsCost).toBeGreaterThan(3)
      expect(forwardCost).toBeLessThan(flankCost)
      expect(opportunityCostOfDelayingShot(
        realShot,a.shooter,a.team,a.setup,a.opponents,sideways))
        .toBe(flankCost)
    })

    it(`prioritizes an immediate physical finish over speculative lateral passing on side ${side}`,()=>{
      const a=stage(side)
      const shot=evaluateShootingOpportunity(
        a.shooter,a.def,a.opponents,a.team,a.setup)!
      const receiver=a.state.players.find(p=>p.playerId===a.dm.playerId)!
      const relocation={xM:a.shooter.position.xM,yM:40}
      const moved={...receiver,position:relocation,
        velocity:{xMps:0,yMps:0}}
      const state:MatchState={...a.state,players:a.state.players.map(p=>
        p.playerId===receiver.playerId?moved:p)}
      const pass={kind:'pass' as const,receiverId:receiver.playerId,
        target:relocation,power:.23,lift:0,utility:shot.utility+4}
      const shoot={kind:'shoot' as const,target:shot.target,
        power:shot.power,lift:shot.lift,utility:shot.utility}
      const review=reviewOnBallActions(state,a.setup,[pass,shoot],shot)
      expect(pass.utility).toBeGreaterThan(shoot.utility)
      expect(review.assessments[0].choice.kind).toBe('shoot')
      const passReview=review.assessments.find(x=>x.choice.kind==='pass')!
      expect(passReview.reasons)
        .toContain('Passing delays a credible immediate shooting window')
      expect(reviewOnBallActions(state,a.setup,[pass,shoot],shot)).toEqual(review)
      expect(state.goalEvents).toHaveLength(0)
      expect(state.contactEvents).toHaveLength(0)
    })
  }

  it('does not force risky shooting against a blocked goalmouth',()=>{
    const blocked=stage(0,{blocked:true})
    const shot=evaluateShootingOpportunity(blocked.shooter,
      blocked.def,blocked.opponents,blocked.team,blocked.setup)
    expect(shot).not.toBeNull()
    const cost=opportunityCostOfDelayingShot(
      shot,blocked.shooter,blocked.team,blocked.setup,
      blocked.opponents,{xM:blocked.shooter.position.xM-4,yM:38})
    expect(cost).toBe(0)
  })

  it('lets better shooters recognize more urgency without forcing poor finishers',()=>{
    const a=stage(0,{shooterX:88})
    const elite=skillSetup(a.setup,a.shooter.playerId,96)
    const low=skillSetup(a.setup,a.shooter.playerId,12)
    const highDef=elite.players.find(p=>p.id===a.shooter.playerId)!
    const lowDef=low.players.find(p=>p.id===a.shooter.playerId)!
    const shotHigh=evaluateShootingOpportunity(
      a.shooter,highDef,a.opponents,a.team,elite)
    const shotLow=evaluateShootingOpportunity(
      a.shooter,lowDef,a.opponents,a.team,low)
    const alt={xM:a.shooter.position.xM,yM:40}
    const highCost=opportunityCostOfDelayingShot(
      shotHigh,a.shooter,a.team,elite,a.opponents,alt)
    const lowCost=opportunityCostOfDelayingShot(
      shotLow,a.shooter,a.team,low,a.opponents,alt)
    expect(highCost).toBeGreaterThan(0)
    expect(highCost).toBeGreaterThan(lowCost)
    expect(highCost).toBeLessThanOrEqual(17)
  })

})
