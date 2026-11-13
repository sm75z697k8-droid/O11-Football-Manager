import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import type {
  MatchState, ContactEvent, AutomaticContactEvent,
} from '../../src/game/match/state'
import {
  latestPhysicalGoalTouch, disallowedDirectGoal,
} from '../../src/game/match/goal-eligibility'
import { adjudicatePhysicalGoal } from '../../src/game/match/goals'
import { recordOutOfPlay } from '../../src/game/match/restarts'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'

type Origin = 'throwIn' | 'keeperThrow' | 'goalKick' | 'cornerKick' |
  'openingKickoff' | 'secondHalfKickoff' | 'afterGoalKickoff' |
  'directFreeKick' | 'indirectFreeKick' | 'penalty' | 'ordinary'
function release(origin:Origin,playerId:string):ContactEvent {
  const detail: Record<Origin, {
    commandId:string,kind:ContactEvent['kind'],outcome:ContactEvent['outcome']
  }> = {
    throwIn: {commandId:'ai-pass-throwin-90',kind:'throwIn',outcome:'thrownIn'},
    keeperThrow: {commandId:'keeper-distribution',kind:'throw',outcome:'thrown'},
    goalKick: {commandId:'ai-pass-goalkick-90',kind:'goalKick',outcome:'goalKicked'},
    cornerKick: {commandId:'ai-pass-corner-90',kind:'cornerKick',outcome:'cornerKicked'},
    openingKickoff: {commandId:'o11-opening-kickoff',kind:'kick',outcome:'kicked'},
    secondHalfKickoff: {commandId:'ai-pass-secondhalf-90-A',kind:'kick',outcome:'kicked'},
    afterGoalKickoff: {commandId:'ai-pass-postgoal-90-A',kind:'kick',outcome:'kicked'},
    directFreeKick: {commandId:'ai-pass-foul-90-A',kind:'kick',outcome:'kicked'},
    indirectFreeKick: {commandId:'ai-pass-offside-90-A',kind:'kick',outcome:'kicked'},
    penalty: {commandId:'ai-shot-penalty-90-A',kind:'kick',outcome:'kicked'},
    ordinary: {commandId:'ai-shot-standard-90',kind:'kick',outcome:'kicked'},
  }
  return { tick:90,playerId,drawUsed:1,...detail[origin] }
}
function scene(
  origin:Origin, direction:1|-1, ownGoal:boolean,
  finalTouch:'none'|'teammate'|'opponent'|'deflection'|'heldOff'='none',
) {
  const setup=makeFictionalMatchSetup()
  const base=createFoundationMatch(setup).getState()
  const scoring=base.teams.find(t=>t.attackingDirection===direction)!
  const defending=base.teams.find(t=>t.clubId!==scoring.clubId)!
  const actorTeam=ownGoal?defending:scoring
  const actor=base.players.find(p=>p.clubId===actorTeam.clubId &&
    p.formationSlot===(origin==='keeperThrow'?'GK':'ST'))!
  const other=base.players.find(p=>
    p.clubId===(finalTouch==='teammate'?actorTeam.clubId:
      actorTeam.clubId===scoring.clubId?defending.clubId:scoring.clubId) &&
      p.playerId!==actor.playerId && p.formationSlot==='RCM')!
  const manual:ContactEvent[]=[release(origin,actor.playerId)]
  const auto:AutomaticContactEvent[]=[]
  let finalId=actor.playerId
  if(finalTouch==='teammate'||finalTouch==='opponent'){
    manual.push({commandId:'second-physical-touch',playerId:other.playerId,
      tick:95,kind:'control',outcome:'miscontrolled',drawUsed:1})
    finalId=other.playerId
  }
  if(finalTouch==='deflection'){
    auto.push({tick:95,playerId:other.playerId,
      kind:'interception',outcome:'deflected',contactFraction:.25})
    finalId=other.playerId
  }
  if(finalTouch==='heldOff'){
    auto.push({tick:95,playerId:other.playerId,
      kind:'challenge',outcome:'heldOff',contactFraction:.25})
  }
  const fromX=direction===1?setup.pitch.lengthM-.5:.5
  const toX=direction===1
    ?setup.pitch.lengthM+BALL_RADIUS_M+.35
    :-BALL_RADIUS_M-.35
  const before:MatchState={
    ...base,kickoff:null,clock:{...base.clock,tick:100},
    contactEvents:manual,automaticContactEvents:auto,
    ball:{...base.ball,position:{xM:fromX,yM:setup.pitch.widthM/2},
      lastTouchPlayerId:finalId,
      controllerId:null,controlOffset:null,
      heightM:BALL_RADIUS_M,velocity:{xMps:direction*24,yMps:0,zMps:0},
      outsidePitch:false},
  }
  const after:MatchState={
    ...before,clock:{...before.clock,tick:101},
    ball:{...before.ball,
      position:{xM:toX,yM:setup.pitch.widthM/2},
      outsidePitch:true},
  }
  return {setup,before,after,scoring,defending,actor,other}
}
function whistle(s:ReturnType<typeof scene>){
  const adjudicated=adjudicatePhysicalGoal(s.before,s.after,s.setup)
  return recordOutOfPlay(s.before,adjudicated,s.setup)
}
function expectNoGoal(
  s:ReturnType<typeof scene>, expected:'goalKick'|'corner',
){
  const reviewed=whistle(s)
  expect(reviewed.goalEvents).toHaveLength(0)
  expect(reviewed.teams.map(t=>t.score)).toEqual([0,0])
  expect(reviewed.postGoalKickoff).toBeNull()
  expect(reviewed.restart?.kind).toBe(expected)
  expect(reviewed.restart?.awardedTeamId).toBe(
    expected==='goalKick'?s.defending.clubId:s.scoring.clubId)
  expect(reviewed.outOfPlayEvents).toHaveLength(1)
  expect(reviewed.outOfPlayEvents[0].lastTouchPlayerId)
    .toBe(s.actor.playerId)
  expect(reviewed.ball.controllerId).toBeNull()
  expect(reviewed.ball.velocity).toEqual({xMps:0,yMps:0,zMps:0})
}
function expectGoal(s:ReturnType<typeof scene>){
  const reviewed=whistle(s)
  expect(reviewed.goalEvents).toHaveLength(1)
  expect(reviewed.goalEvents[0].scoringTeamId).toBe(s.scoring.clubId)
  expect(reviewed.goalEvents[0].lastTouchPlayerId)
    .toBe(s.after.ball.lastTouchPlayerId)
  expect(reviewed.teams.find(t=>t.clubId===s.scoring.clubId)?.score)
    .toBe(1)
  expect(reviewed.postGoalKickoff?.teamId).toBe(s.defending.clubId)
  expect(reviewed.restart).toBeNull()
  expect(reviewed.outOfPlayEvents).toHaveLength(0)
}

describe('S1.7.1 lawful physical goalmouth crossings',()=>{
  for(const direction of [1,-1] as const){
    it('Law 15: direct throw-in into either goal is NEVER a goal, side '+direction,()=>{
      expectNoGoal(scene('throwIn',direction,false),'goalKick')
      expectNoGoal(scene('throwIn',direction,true),'corner')
    })
    it('Law 10: an untouched GK hand throw cannot score against opponents, side '+direction,()=>{
      expectNoGoal(scene('keeperThrow',direction,false),'goalKick')
      // Law 10 expressly prohibits only a direct throw into the OTHER goal.
      expectGoal(scene('keeperThrow',direction,true))
    })
    it('Law 13: indirect free kick directly into either net is disallowed, side '+direction,()=>{
      expectNoGoal(scene('indirectFreeKick',direction,false),'goalKick')
      expectNoGoal(scene('indirectFreeKick',direction,true),'corner')
    })
    it('Law 8: kickoffs score against opponents but never directly as own goals, side '+direction,()=>{
      for(const kind of ['openingKickoff','secondHalfKickoff',
        'afterGoalKickoff'] as const){
        expectGoal(scene(kind,direction,false))
        expectNoGoal(scene(kind,direction,true),'corner')
      }
    })
    it('Laws 13/16/17: direct FK, corner and goal kick may score only against opponents, side '+direction,()=>{
      for(const kind of ['directFreeKick','goalKick','cornerKick'] as const){
        expectGoal(scene(kind,direction,false))
        expectNoGoal(scene(kind,direction,true),'corner')
      }
    })
    it('normal own goals, open-play shots and penalties retain their scoring path, side '+direction,()=>{
      expectGoal(scene('ordinary',direction,false))
      expectGoal(scene('ordinary',direction,true))
      expectGoal(scene('penalty',direction,false))
    })
    it('one real SECOND touch makes a former direct throw-in scoreable, side '+direction,()=>{
      for(const kind of ['teammate','opponent','deflection'] as const){
        const s=scene('throwIn',direction,false,kind)
        expect(disallowedDirectGoal(s.after,s.scoring.clubId)).toBeNull()
        expectGoal(s)
      }
      expectGoal(scene('keeperThrow',direction,false,'deflection'))
      expectGoal(scene('indirectFreeKick',direction,false,'deflection'))
    })
    it('an attempted touch or an unsuccessful physical challenge does not erase directness, side '+direction,()=>{
      const s=scene('throwIn',direction,false,'heldOff')
      const after:MatchState={...s.after,contactEvents:[
        ...s.after.contactEvents,{tick:97,playerId:s.other.playerId,
          commandId:'missed-control',kind:'control',outcome:'outOfReach',
          drawUsed:0},
      ]}
      expect(latestPhysicalGoalTouch(after)?.origin).toBe('throwIn')
      expectNoGoal({...s,after},'goalKick')
    })
  }
  it('reconstructs historical goal eligibility without mistaking later touches for earlier touches',()=>{
    const s=scene('throwIn',1,false)
    const later:MatchState={
      ...s.after,clock:{...s.after.clock,tick:135},
      contactEvents:[...s.after.contactEvents,{
        tick:130,commandId:'later-shot',
        playerId:s.other.playerId,kind:'kick',outcome:'kicked',drawUsed:1,
      }],
    }
    expect(disallowedDirectGoal(later,s.scoring.clubId,101)?.origin)
      .toBe('throwIn')
    expect(latestPhysicalGoalTouch(later,101)?.playerId)
      .toBe(s.actor.playerId)
    expect(latestPhysicalGoalTouch(later,135)?.playerId)
      .toBe(s.other.playerId)
  })
  it('does not waste old history on a fake awarded free kick when no physical release occurred',()=>{
    const s=scene('ordinary',1,false)
    const withFailed:MatchState={...s.after,
      contactEvents:[...s.after.contactEvents,{
        tick:97,commandId:'ai-pass-offside-97-failed',
        playerId:s.actor.playerId,kind:'kick',outcome:'outOfReach',drawUsed:0,
      }],
    }
    expect(disallowedDirectGoal(withFailed,s.scoring.clubId)).toBeNull()
    expectGoal({...s,after:withFailed})
  })
})
