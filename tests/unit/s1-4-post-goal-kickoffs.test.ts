import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { applyDueMatchCommands, scheduleMatchCommand } from '../../src/game/match/commands'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { adjudicatePhysicalGoal } from '../../src/game/match/goals'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import {
  postGoalKickoffAward, postGoalKickoffTarget,
  postGoalKickoffPlayersLegal, postGoalKickoffBallStationary,
  stagePostGoalKickoff, advancePostGoalKickoff,
  postGoalKickoffCommandPrefix,
} from '../../src/game/match/post-goal-kickoff'
import { forbiddenRestartSecondTouch } from '../../src/game/match/restarts'
import type { MatchState } from '../../src/game/match/state'

function scoredGoal(
  scoringIndex: 0 | 1, ownGoal = false,
) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const side = scoringIndex === 0 ? 'right' : 'left'
  const direction = scoringIndex === 0 ? 1 : -1
  const goalX = scoringIndex === 0 ? setup.pitch.lengthM : 0
  const touchingClub = ownGoal
    ? initial.teams[1-scoringIndex].clubId
    : initial.teams[scoringIndex].clubId
  const toucher = initial.players.find(p =>
    p.clubId === touchingClub && p.formationSlot === 'ST')!
  const before: MatchState = {
    ...initial,
    clock: { ...initial.clock, tick: 99 },
    ai: { ...initial.ai, enabledTeams: [true,true] },
    ball: {
      ...initial.ball,
      position: {xM:goalX-direction*.06,yM:setup.pitch.widthM/2},
      heightM:BALL_RADIUS_M,
      controllerId:null, controlOffset:null,
      outsidePitch:false,
      lastTouchPlayerId:toucher.playerId,
      velocity: {xMps:direction*15,yMps:0,zMps:0},
    },
  }
  const after: MatchState = {
    ...before,
    clock: { ...before.clock, tick: 100 },
    ball: {
      ...before.ball,
      position: {xM:goalX+direction*.18,yM:setup.pitch.widthM/2},
      outsidePitch:true,
    },
  }
  const scored = adjudicatePhysicalGoal(before,after,setup)
  expect(scored.goalEvents).toHaveLength(1)
  expect(scored.goalEvents[0].side).toBe(side)
  return {setup, scored, scorer:toucher, scoringIndex}
}
function ready(scoringIndex: 0|1 = 0) {
  const scene = scoredGoal(scoringIndex)
  const restart = scene.scored.postGoalKickoff!
  const initial = stagePostGoalKickoff(scene.scored,scene.setup)
  const players = initial.players.map(p => ({
    ...p,
    position: postGoalKickoffTarget(initial,scene.setup,restart,p),
    velocity: {xMps:0,yMps:0},
  }))
  const state: MatchState = {
    ...scene.scored,
    clock: { ...scene.scored.clock, tick: 200 },
    players,
  }
  return {...scene,restart,state}
}

describe('S1.4 Law 8 physical post-goal kickoffs', () => {
  it('awards the conceding team after either goal, preserving first kickoff data', () => {
    for (const index of [0,1] as const) {
      for (const ownGoal of [false,true]) {
        const scene = scoredGoal(index,ownGoal)
        const restart = scene.scored.postGoalKickoff!
        expect(restart.goalTick).toBe(100)
        expect(restart.teamId).toBe(
          scene.scored.teams[1-index].clubId)
        expect(restart.phase).toBe('staging')
        expect(restart.kickedTick).toBeNull()
        const kicker = scene.scored.players.find(p =>
          p.playerId === restart.kickerId)!
        expect(kicker.clubId).toBe(restart.teamId)
        expect(kicker.formationSlot).toBe('ST')
        expect(scene.scored.kickoff).toBe(scene.scored.kickoff)
        expect(scene.scored.ball.position).toEqual({
          xM:scene.setup.pitch.lengthM/2,
          yM:scene.setup.pitch.widthM/2,
        })
        expect(postGoalKickoffBallStationary(
          scene.scored,scene.setup)).toBe(true)
        expect(scene.scored.ball.lastTouchPlayerId).toBe(scene.scorer.playerId)
        expect(scene.scored.teams.map(t=>t.score))
          .toEqual(index===0?[1,0]:[0,1])
      }
    }
  })

  it('moves all 22 players physically and cannot start with opponents inside centre circle', () => {
    for (const scoringIndex of [0,1] as const) {
      const scene = scoredGoal(scoringIndex)
      const prepared = stagePostGoalKickoff(scene.scored,scene.setup)
      expect(prepared.players).toHaveLength(22)
      expect(prepared.ball).toEqual(scene.scored.ball)
      expect(prepared.players.some((p,i)=>
        p.intention.kind === 'moveToPoint' &&
        (p.position.xM !== scene.scored.players[i].position.xM ||
        p.position.yM !== scene.scored.players[i].position.yM))).toBe(false)
      expect(prepared.pendingCommands).toHaveLength(0)
      const restart = scene.scored.postGoalKickoff!
      const centre = {
        xM:scene.setup.pitch.lengthM/2,
        yM:scene.setup.pitch.widthM/2,
      }
      const targets = prepared.players.map(p=>
        postGoalKickoffTarget(prepared,scene.setup,restart,p))
      for(let i=0;i<targets.length;i++){
        const p=prepared.players[i]
        const team=prepared.teams.find(t=>t.clubId===p.clubId)!
        if(p.playerId!==restart.kickerId){
          expect((targets[i].xM-centre.xM)*(-team.attackingDirection))
            .toBeGreaterThan(0)
        }
        if(p.clubId!==restart.teamId){
          expect(Math.hypot(targets[i].xM-centre.xM,
            targets[i].yM-centre.yM)).toBeGreaterThanOrEqual(9.15)
        }
      }
      const kick = ready(scoringIndex)
      expect(postGoalKickoffPlayersLegal(
        kick.state,kick.setup,kick.restart)).toBe(true)
    }
  })

  it('requires a physical taker and all players in legal halves before releasing', () => {
    const scene = ready()
    const centre = {
      xM:scene.setup.pitch.lengthM/2,
      yM:scene.setup.pitch.widthM/2,
    }
    const opponent = scene.state.players.find(p=>
      p.clubId!==scene.restart.teamId && p.formationSlot==='ST')!
    const illegal: MatchState = {
      ...scene.state,
      players:scene.state.players.map(p=>p.playerId===opponent.playerId
        ? {...p,position:{xM:centre.xM,yM:centre.yM+4}} : p),
    }
    expect(postGoalKickoffPlayersLegal(
      illegal,scene.setup,scene.restart)).toBe(false)
    expect(stagePostGoalKickoff(illegal,scene.setup).pendingCommands)
      .toHaveLength(0)
    const spoof = scheduleMatchCommand(scene.state,{
      commandId:'manual-forged-centre-kick',type:'attemptKick',
      teamId:scene.restart.teamId,playerId:scene.restart.kickerId,
      target:{xM:40,yM:34},power:.8,lift:0,
    },scene.setup.pitch)
    expect(spoof.receipt.accepted).toBe(false)
    const unrelated = scheduleMatchCommand(scene.state,{
      commandId:'illegal-ball-launch',type:'diagnosticBallLaunch',
      teamId:scene.restart.teamId,
      velocity:{xMps:10,yMps:0,zMps:0},
    },scene.setup.pitch)
    expect(unrelated.receipt.accepted).toBe(false)
  })

  it('physically kicks from the centre and only resumes after the ball truly moves', () => {
    for(const index of [0,1] as const){
      const scene=ready(index)
      const planned=stagePostGoalKickoff(scene.state,scene.setup)
      const command=planned.pendingCommands.find(c =>
        c.type==='attemptKick' && c.commandId.startsWith(
          postGoalKickoffCommandPrefix(scene.restart.goalTick)))!
      expect(command).toBeDefined()
      expect(command.teamId).toBe(scene.restart.teamId)
      expect(command.playerId).toBe(scene.restart.kickerId)
      expect(command.power).toBe(.19)
      expect(command.lift).toBe(0)
      const applied=applyDueMatchCommands({
        ...planned,clock:{...planned.clock,tick:201},
      })
      const kicked=advancePostGoalKickoff(
        applied,scene.setup,resolveContactAttempts)
      expect(kicked.postGoalKickoff?.phase).toBe('awaitingMovement')
      expect(kicked.postGoalKickoff?.kickedTick).toBe(201)
      expect(kicked.contactEvents.at(-1)).toMatchObject({
        commandId:command.commandId,
        outcome:'kicked', kind:'kick',drawUsed:1,
      })
      expect(kicked.ball.position).toEqual({
        xM:scene.setup.pitch.lengthM/2,yM:scene.setup.pitch.widthM/2,
      })
      expect(kicked.ball.controllerId).toBeNull()
      expect(forbiddenRestartSecondTouch(kicked,command.playerId)).toBe(true)
      const continued=advancePostGoalKickoff({
        ...kicked,clock:{...kicked.clock,tick:202},
      },scene.setup,resolveContactAttempts)
      expect(continued.postGoalKickoff).toBeNull()
      expect(Math.abs(continued.ball.position.xM-kicked.ball.position.xM))
        .toBeGreaterThan(.035)
      expect(continued.ball.lastTouchPlayerId).toBe(command.playerId)
      expect(continued.goalEvents).toEqual(kicked.goalEvents)
      expect(continued.teams).toEqual(kicked.teams)
      expect(continued.ai.passIntent?.receiverId).toBe(scene.restart.receiverId)
    }
  })

  it('keeps a failed or too-early contact dead, without scoring or inventing possession', () => {
    const scene=ready()
    const planned=stagePostGoalKickoff(scene.state,scene.setup)
    const applied=applyDueMatchCommands({
      ...planned,clock:{...planned.clock,tick:201},
    })
    const bad: MatchState={
      ...applied,
      players:applied.players.map(p=>p.playerId===scene.restart.kickerId
        ? {...p,position:{xM:42,yM:34}}:p),
    }
    const result=advancePostGoalKickoff(
      bad,scene.setup,resolveContactAttempts)
    expect(result.contactEvents.at(-1)?.outcome).toBe('notReady')
    expect(result.postGoalKickoff?.phase).toBe('staging')
    expect(result.ball.velocity).toEqual({xMps:0,yMps:0,zMps:0})
    expect(result.ball.controllerId).toBeNull()
    expect(result.goalEvents).toHaveLength(1)
  })

  it('preserves multiple goal events, aggregate score and correct next-awarded side', () => {
    const first=ready(0)
    const prepared=stagePostGoalKickoff(first.state,first.setup)
    const due=applyDueMatchCommands({
      ...prepared,clock:{...prepared.clock,tick:201},
    })
    const struck=advancePostGoalKickoff(
      due,first.setup,resolveContactAttempts)
    const playing=advancePostGoalKickoff({
      ...struck,clock:{...struck.clock,tick:202},
    },first.setup,resolveContactAttempts)
    const leftGoalX=0
    const before:MatchState={
      ...playing,
      clock:{...playing.clock,tick:300},
      ball:{
        ...playing.ball,position:{xM:.04,yM:first.setup.pitch.widthM/2},
        heightM:BALL_RADIUS_M,
        velocity:{xMps:-17,yMps:0,zMps:0},
        outsidePitch:false,
        lastTouchPlayerId:first.scored.players.find(p=>
          p.clubId===first.scored.teams[1].clubId &&
          p.formationSlot==='ST')!.playerId,
      },
    }
    const next:MatchState={
      ...before,clock:{...before.clock,tick:301},
      ball:{
        ...before.ball,
        position:{xM:leftGoalX-.2,yM:first.setup.pitch.widthM/2},
        outsidePitch:true,
      },
    }
    const scored=adjudicatePhysicalGoal(before,next,first.setup)
    expect(scored.goalEvents).toHaveLength(2)
    expect(scored.goalEvents.map(g=>g.tick)).toEqual([100,301])
    expect(scored.teams.map(t=>t.score)).toEqual([1,1])
    expect(scored.postGoalKickoff?.teamId).toBe(scored.teams[0].clubId)
    expect(scored.postGoalKickoff?.goalTick).toBe(301)
  })

  it('keeps original opening kickoff and ordinary seeded checkpoint replay intact', () => {
    const setup=makeFictionalMatchSetup()
    const game=createFoundationMatch(setup)
    game.advance(20)
    expect(game.getState().postGoalKickoff).toBeNull()
    expect(restoreFoundationMatch(game.checkpoint()).checkpoint())
      .toEqual(game.checkpoint())
  })
})
