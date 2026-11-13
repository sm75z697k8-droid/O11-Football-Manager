import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import {
  CLOSE_CONTROL_MAX_OFFSET_M, advanceControlledBall,
  closeControlOffset,
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
      velocity:{xMps:6,yMps:0}}
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
