import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import {
  CLOSE_CONTROL_MAX_OFFSET_M, advanceControlledBall,
  closeControlOffset, activeCarryingTouch,
} from '../../src/game/physics/contact'
import { projectPlayerToward } from '../../src/game/physics/locomotion'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { GOALKEEPER_HAND_HEIGHT_M } from '../../src/game/physics/goalkeeper-handling'
import { MatchViewerSession } from '../../src/game/viewer/session'
import type { BallMatchState, PlayerMatchState } from '../../src/game/match/state'

function stage(side: 0|1) {
  const setup=makeFictionalMatchSetup()
  const initial=createFoundationMatch(setup).getState()
  const team=initial.teams[side]
  const player=initial.players.find(p=>
    p.clubId===team.clubId && p.formationSlot==='ST')!
  const definition=setup.players.find(p=>p.id===player.playerId)!
  const start={xM:side===0?35:70,yM:34}
  const facing=side===0?0:Math.PI
  const owner:PlayerMatchState={...player,
    position:start,orientationRad:facing,
    velocity:{xMps:0,yMps:0}}
  const ball:BallMatchState={
    ...initial.ball,
    position:{xM:start.xM-Math.cos(facing)*.74,
      yM:start.yM-Math.sin(facing)*.74},
    velocity:{xMps:0,yMps:0,zMps:0},
    heightM:BALL_RADIUS_M,controllerId:player.playerId,
    controlOffset:{xM:-Math.cos(facing)*.74,
      yM:-Math.sin(facing)*.74},
    lastTouchPlayerId:player.playerId,outsidePitch:false,
  }
  return {setup,side,team,owner,definition,ball}
}

function gap(a:{xM:number;yM:number}, b:{xM:number;yM:number}) {
  return Math.hypot(a.xM-b.xM,a.yM-b.yM)
}

describe('Phase 6.9N — bounded, direction-aware physical close control',()=>{
  for(const side of [0,1] as const) {
    it(`turns a ball behind the player into a believable forward foot position on side ${side}`,()=>{
      const a=stage(side)
      let player=a.owner
      let ball=a.ball
      const firstTarget={
        xM:player.position.xM+a.team.attackingDirection*12,
        yM:player.position.yM,
      }
      let prevBall=ball
      let firstBallStep=0
      for(let tick=1;tick<=90;tick++){
        player=projectPlayerToward(
          player,a.definition,firstTarget,a.setup.pitch,tick)
        prevBall=ball
        ball=advanceControlledBall(
          ball,player,a.setup.pitch,a.definition)
        if(tick===1)firstBallStep=gap(prevBall.controlOffset!,
          ball.controlOffset!)
        expect(ball.controllerId).toBe(a.owner.playerId)
        expect(ball.lastTouchPlayerId).toBe(a.owner.playerId)
        expect(ball.controlOffset).not.toBeNull()
        expect(gap(ball.position,player.position))
          .toBeLessThanOrEqual(CLOSE_CONTROL_MAX_OFFSET_M+1e-8)
        expect(ball.outsidePitch).toBe(false)
        expect(ball.velocity.xMps).toBe(player.velocity.xMps)
        expect(ball.velocity.yMps).toBe(player.velocity.yMps)
        expect(ball.heightM).toBe(BALL_RADIUS_M)
      }
      // A sudden jump straight to the player's front is forbidden.
      expect(firstBallStep).toBeLessThan(.28)
      const forward=Math.cos(player.orientationRad)*
        ball.controlOffset!.xM+Math.sin(player.orientationRad)*
        ball.controlOffset!.yM
      expect(forward).toBeGreaterThan(.35)
      const afterStraight=ball
      // Opposite flank: rotate the player through a genuine locomotion
      // turn while the ball smoothly follows inside the foot envelope.
      const turnTarget={
        xM:player.position.xM-a.team.attackingDirection*7,
        yM:player.position.yM+6,
      }
      let maxStep=0
      for(let tick=91;tick<=165;tick++){
        player=projectPlayerToward(
          player,a.definition,turnTarget,a.setup.pitch,tick)
        const prior=ball
        ball=advanceControlledBall(
          ball,player,a.setup.pitch,a.definition)
        maxStep=Math.max(maxStep,
          gap(prior.controlOffset!,ball.controlOffset!))
        expect(ball.controllerId).toBe(a.owner.playerId)
        expect(gap(ball.position,player.position))
          .toBeLessThanOrEqual(CLOSE_CONTROL_MAX_OFFSET_M+1e-8)
        expect(ball.outsidePitch).toBe(false)
      }
      expect(maxStep).toBeLessThan(.29)
      expect(gap(afterStraight.controlOffset!,ball.controlOffset!))
        .toBeGreaterThan(.4)
    })
  }

  it('uses First Touch, Dribbling, Balance, Agility and Composure to alter controlled-ball responsiveness',()=>{
    const a=stage(0)
    const low={...a.definition,abilities:{
      ...a.definition.abilities,
      technical:{...a.definition.abilities.technical,
        dribbling:10,firstTouch:10},
      physical:{...a.definition.abilities.physical,
        agility:10,balance:10},
      mental:{...a.definition.abilities.mental,composure:10},
    }}
    const high={...a.definition,abilities:{
      ...a.definition.abilities,
      technical:{...a.definition.abilities.technical,
        dribbling:95,firstTouch:95},
      physical:{...a.definition.abilities.physical,
        agility:95,balance:95},
      mental:{...a.definition.abilities.mental,composure:95},
    }}
    const slow=closeControlOffset(a.ball,a.owner,low,a.setup.pitch)
    const fast=closeControlOffset(a.ball,a.owner,high,a.setup.pitch)
    expect(fast.xM).toBeGreaterThan(slow.xM)
    expect(Math.hypot(fast.xM,fast.yM))
      .toBeLessThanOrEqual(CLOSE_CONTROL_MAX_OFFSET_M)
    const second=closeControlOffset(a.ball,a.owner,high,a.setup.pitch)
    expect(second).toEqual(fast)
    expect(a.ball.controlOffset!.xM).toBeLessThan(0)
  })

  it('prevents a controlled forward ball from falling out at the touchline without defender contact',()=>{
    const a=stage(0)
    let player:PlayerMatchState={...a.owner,
      position:{xM:a.setup.pitch.lengthM-.15,yM:34},
      orientationRad:0,velocity:{xMps:6,yMps:0}}
    let ball:BallMatchState={...a.ball,
      position:{xM:player.position.xM+.75,yM:34},
      controlOffset:{xM:.75,yM:0},
      velocity:{xMps:6,yMps:0,zMps:0}}
    for(let tick=0;tick<25;tick++){
      ball=advanceControlledBall(ball,player,a.setup.pitch,a.definition)
      expect(ball.outsidePitch).toBe(false)
      expect(ball.position.xM).toBeLessThanOrEqual(
        a.setup.pitch.lengthM-BALL_RADIUS_M+1e-8)
      expect(gap(ball.position,player.position))
        .toBeLessThanOrEqual(CLOSE_CONTROL_MAX_OFFSET_M+1e-8)
      player={...player,velocity:{xMps:0,yMps:0}}
    }
    expect(ball.controllerId).toBe(player.playerId)
  })

  it('does not change the physical hand-held goalkeeper catch offset',()=>{
    const a=stage(0)
    const original=createFoundationMatch(a.setup).getState()
    const keeper=original.players.find(p=>
      p.clubId===a.owner.clubId && p.formationSlot==='GK')!
    const definition=a.setup.players.find(p=>p.id===keeper.playerId)!
    const ball:BallMatchState={...original.ball,
      position:{xM:keeper.position.xM+.28,yM:keeper.position.yM},
      heightM:GOALKEEPER_HAND_HEIGHT_M,
      controlOffset:{xM:.28,yM:0},
      controllerId:keeper.playerId}
    const after=advanceControlledBall(ball,keeper,a.setup.pitch,definition)
    expect(after.controlOffset).toEqual(ball.controlOffset)
    expect(after.position).toEqual(ball.position)
    expect(after.heightM).toBe(GOALKEEPER_HAND_HEIGHT_M)
  })

  for(const side of [0,1] as const){
    it(`PHY-F1 corrects a misaligned carried ball even when marked from direction ${side}`,()=>{
      const a=stage(side)
      const original=createFoundationMatch(a.setup).getState()
      const direction=a.team.attackingDirection
      const target={xM:a.owner.position.xM+direction*18,yM:34}
      let owner:PlayerMatchState={...a.owner,
        intention:{kind:'moveToPoint' as const,
          target,sinceTick:0},
        velocity:{xMps:direction*3.3,yMps:0}}
      const misaligned:BallMatchState={...a.ball,
        position:{xM:owner.position.xM-direction*.46,yM:34},
        controlOffset:{xM:-direction*.46,yM:0}}
      let openBall=misaligned
      let pressuredBall=misaligned
      let maxMovement=0
      for(let tick=1;tick<=22;tick++){
        owner=projectPlayerToward(owner,a.definition,target,a.setup.pitch,tick)
        const defender={xM:owner.position.xM+direction*1.25,yM:owner.position.yM+.4}
        const decision={playerId:owner.playerId,clubId:owner.clubId,
          tick,action:'carry' as const,target,engage:true}
        const current={...original,clock:{...original.clock,tick},
          players:original.players.map(p=>p.playerId===owner.playerId?owner:p),
          ball:pressuredBall,
          ai:{...original.ai,decisionSnapshot:[decision]}}
        expect(activeCarryingTouch(current,owner)).toBe(true)
        const next=advanceControlledBall(pressuredBall,owner,a.setup.pitch,
          a.definition,defender)
        const free=advanceControlledBall(openBall,owner,a.setup.pitch,
          a.definition)
        maxMovement=Math.max(maxMovement,gap(pressuredBall.controlOffset!,
          next.controlOffset!))
        expect(gap(next.position,owner.position))
          .toBeLessThanOrEqual(CLOSE_CONTROL_MAX_OFFSET_M+1e-9)
        expect(next.controllerId).toBe(owner.playerId)
        expect(next.lastTouchPlayerId).toBe(owner.playerId)
        expect(next.outsidePitch).toBe(false)
        pressuredBall=next
        openBall=free
      }
      // Well-aligned touches must not be unnecessarily rewritten merely
      // because a defender is nearby; that would distort seeded football.
      const alignedState={...createFoundationMatch(a.setup).getState(),
        ball:{...a.ball,controlOffset:{xM:direction*.5,yM:0}},
        ai:{...createFoundationMatch(a.setup).getState().ai,
          decisionSnapshot:[{playerId:owner.playerId,clubId:owner.clubId,
            tick:30,action:'carry' as const,target,engage:true}]}}
      expect(activeCarryingTouch(alignedState,owner)).toBe(false)
      expect(maxMovement).toBeGreaterThan(.001)
      expect(maxMovement).toBeLessThan(.3)
      // Under real close pressure the ball stays closer to the carrier's
      // foot compared with the same unchallenged sprint.
      expect(gap(pressuredBall.position,owner.position))
        .toBeLessThan(gap(openBall.position,owner.position))
    })
    it(`PHY-F1 retains authentic first-touch geometry until a moving carry on side ${side}`,()=>{
      const a=stage(side)
      const initial=createFoundationMatch(a.setup).getState()
      const direction=a.team.attackingDirection
      const target={xM:a.owner.position.xM+direction*10,yM:34}
      const receiving={...a.owner,intention:{
        kind:'moveToPoint' as const,target,sinceTick:1},
        velocity:{xMps:direction*2,yMps:0}}
      const press={xM:receiving.position.xM+direction*1.8,yM:34}
      const snapshot={playerId:receiving.playerId,clubId:receiving.clubId,
        tick:1,action:'receive' as const,target,engage:true}
      const afterTouch={...initial,
        clock:{...initial.clock,tick:1},
        ball:a.ball,
        ai:{...initial.ai,decisionSnapshot:[snapshot]}}
      expect(activeCarryingTouch(afterTouch,receiving)).toBe(false)
      const held=advanceControlledBall(a.ball,receiving,a.setup.pitch)
      expect(held.controlOffset).toEqual(a.ball.controlOffset)
      const prepared={...afterTouch,ball:held,
        ai:{...initial.ai,decisionSnapshot:[{
          ...snapshot,action:'carry' as const}]}}
      expect(activeCarryingTouch(prepared,receiving)).toBe(true)
      const controlled=advanceControlledBall(
        held,receiving,a.setup.pitch,a.definition,press)
      expect(gap(controlled.controlOffset!,held.controlOffset!))
        .toBeLessThan(.3)
      expect(controlled.controllerId).toBe(a.owner.playerId)
      expect(controlled.position.xM).not.toBe(held.position.xM)
    })
  }

  it('PHY-F1 does not shift the actual ball contact point on a scheduled kick or stationary receive',()=>{
    const a=stage(0)
    const base=createFoundationMatch(a.setup).getState()
    const player={...a.owner,intention:{
      kind:'moveToPoint' as const,
      target:{xM:a.owner.position.xM+12,yM:34},sinceTick:4},
      velocity:{xMps:2,yMps:0}}
    const decision={playerId:player.playerId,clubId:player.clubId,
      action:'carry' as const,
      target:{xM:a.owner.position.xM+12,yM:34},tick:5,engage:true}
    const active={...base,clock:{...base.clock,tick:5},
      ball:a.ball,ai:{...base.ai,decisionSnapshot:[decision]}}
    expect(activeCarryingTouch(active,player)).toBe(true)
    const command={
      type:'attemptKick' as const,commandId:'test-carry-contact',
      teamId:player.clubId,playerId:player.playerId,
      requestedTick:4,targetTick:5,appliedTick:5,
      target:{xM:60,yM:34},power:.45,lift:0,sequence:1,
    }
    const kicking={...active,appliedCommands:[command]}
    expect(activeCarryingTouch(kicking,player)).toBe(false)
    const unchanged=advanceControlledBall(
      kicking.ball,player,a.setup.pitch)
    expect(unchanged.controlOffset).toEqual(a.ball.controlOffset)
    expect(activeCarryingTouch({
      ...active,ai:{...base.ai,decisionSnapshot:[{...decision,
        action:'shoot' as const}]}
    },player)).toBe(false)
    expect(activeCarryingTouch({
      ...active,ball:{...active.ball,heightM:GOALKEEPER_HAND_HEIGHT_M}
    },player)).toBe(false)
  })

  it('keeps exact live-seed physical checkpoint replay including controlled-ball offsets',()=>{
    const session=new MatchViewerSession(90)
    for(let i=0;i<350 && !session.state.ball.outsidePitch &&
        !session.state.goalEvents.length;i++)session.advance(4)
    const saved=session.checkpoint()
    const restored=restoreFoundationMatch(saved)
    expect(restored.checkpoint()).toEqual(saved)
    for(let i=0;i<70&&!session.state.ball.outsidePitch &&
        !session.state.goalEvents.length;i++) {
      session.advance(1)
      restored.advance(1)
      expect(restored.checkpoint()).toEqual(session.checkpoint())
    }
  },20000)
})
