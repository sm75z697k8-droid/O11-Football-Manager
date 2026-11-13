import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import {
  planDefensiveResponsibilities, pressingApproachTarget,
} from '../../src/game/ai/defensive-shape'
import { projectPlayerToward } from '../../src/game/physics/locomotion'
import type { MatchState, PressingIntensity } from '../../src/game/match/state'

interface SceneOptions {
  x?: number
  y?: number
  leadM?: number
  secondM?: number
  type?: PressingIntensity
  previousPress?: 'RCM' | 'LCM'
  moveTowardGoal?: boolean
  justReceived?: boolean
  looseBall?: boolean
}

function stage(side: 0 | 1, options: SceneOptions = {}) {
  const setup = makeFictionalMatchSetup()
  const original = createFoundationMatch(setup).getState()
  const team = original.teams[side]
  const opposition = original.teams[1-side]
  const dir = team.attackingDirection
  const ballPoint = {
    xM: options.x ?? (side === 0 ? 80 : 25),
    yM: options.y ?? 34,
  }
  const carrier = original.players.find(p =>
    p.clubId === opposition.clubId && p.formationSlot === 'ST')!
  const primary = original.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'RCM')!
  const secondary = original.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'LCM')!
  const players = original.players.map(p => {
    let position = p.position
    if (p.playerId === carrier.playerId) position = ballPoint
    else if (p.playerId === primary.playerId) {
      position = {
        xM: ballPoint.xM - dir * (options.leadM ?? 14),
        yM: ballPoint.yM,
      }
    } else if (p.playerId === secondary.playerId) {
      position = {
        xM: ballPoint.xM - dir * (options.secondM ?? 19),
        yM: ballPoint.yM,
      }
    } else if (p.clubId === team.clubId) {
      position = {
        xM: side === 0 ? 14 : 91,
        yM: p.position.yM,
      }
    } else {
      position = {
        xM: side === 0 ? 92 : 13,
        yM: p.position.yM,
      }
    }
    return {...p, position,
      velocity: p.playerId === carrier.playerId
        ? {xMps: options.moveTowardGoal ? -dir * 3 : 0, yMps: 0}
        : {xMps:0,yMps:0},
    }
  })
  const previousPress = options.previousPress === 'RCM' ? primary :
    options.previousPress === 'LCM' ? secondary : null
  const state: MatchState = {
    ...original,
    kickoff:null,
    clock:{...original.clock,tick:120},
    players,
    teams: [
      {...original.teams[0],
        pressingIntensity: side===0 ?
          options.type ?? 'standard' : original.teams[0].pressingIntensity},
      {...original.teams[1],
        pressingIntensity: side===1 ?
          options.type ?? 'standard' : original.teams[1].pressingIntensity},
    ],
    ball:{...original.ball,position:ballPoint,
      heightM:.11,controllerId: options.looseBall ? null : carrier.playerId,
      lastTouchPlayerId:carrier.playerId,
      controlOffset:options.looseBall?null:{xM:0,yM:0},
      velocity:{xMps:0,yMps:0,zMps:0},
      outsidePitch:false},
    ai:{...original.ai,enabledTeams:[true,true],
      decisionSnapshot:previousPress?[{
        tick:108,clubId:team.clubId,playerId:previousPress.playerId,
        engage:true,action:'press',target:ballPoint,
      }]:[]},
    contactEvents:options.justReceived?[{
      commandId:'synthetic-first-touch',playerId:carrier.playerId,
      kind:'control',outcome:'controlled',tick:116,drawUsed:1,
    }]:[],
  }
  const defending = () => planTeamDecisions(state,setup)
    .filter(d=>d.clubId===team.clubId)
  const pressers = () => defending().filter(d=>d.action==='press')
  return {setup,state,team,opposition,carrier,primary,secondary,
    defending,pressers,ballPoint}
}

describe('Phase 6.9O — trigger-based pressing and defensive restraint',()=>{
  for(const side of [0,1] as const) {
    it(`does not sprint from 14 metres at harmless central possession on side ${side}`,()=>{
      const low=stage(side,{type:'low'})
      const normal=stage(side,{type:'standard'})
      const high=stage(side,{type:'high'})
      expect(low.pressers()).toHaveLength(0)
      expect(normal.pressers()).toHaveLength(0)
      expect(high.pressers()).toHaveLength(1)
      expect(high.pressers()[0].playerId).toBe(high.primary.playerId)
      expect(normal.defending()).toHaveLength(11)
      expect(normal.defending().every(d=>!d.engage)).toBe(true)
      expect(normal.defending().some(d=>d.action==='recover')).toBe(true)
      expect(normal.defending().filter(d=>d.action==='cover')).toHaveLength(1)
    })

    it(`uses two coordinated high pressers only for a nearby wide trap on side ${side}`,()=>{
      const normal=stage(side,{y:5,leadM:8,secondM:10,type:'standard'})
      const high=stage(side,{y:5,leadM:8,secondM:10,type:'high'})
      const low=stage(side,{y:5,leadM:8,secondM:10,type:'low'})
      expect(normal.pressers()).toHaveLength(1)
      expect(high.pressers()).toHaveLength(2)
      expect(new Set(high.pressers().map(d=>d.playerId)).size).toBe(2)
      expect(low.pressers()).toHaveLength(0)
      expect(high.defending().filter(d=>d.engage)).toHaveLength(2)
      expect(high.defending().filter(d=>d.action==='cover')).toHaveLength(1)
      expect(high.defending().filter(d=>d.action==='recover').length)
        .toBeGreaterThanOrEqual(1)
    })

    it(`emergency goal pressure still commits under low settings on side ${side}`,()=>{
      const dangerX=side===0?17:88
      const low=stage(side,{x:dangerX,leadM:7,secondM:10,type:'low'})
      const normal=stage(side,{x:dangerX,leadM:7,secondM:10,type:'standard'})
      const high=stage(side,{x:dangerX,leadM:7,secondM:10,type:'high'})
      expect(low.pressers()).toHaveLength(1)
      expect(normal.pressers()).toHaveLength(1)
      expect(high.pressers()).toHaveLength(2)
      // A defender already within immediate tackling reach goes to the
      // real ball, not an artificial point behind it.
      expect((low.pressers()[0].target.xM-dangerX)*low.team.attackingDirection)
        .toBeLessThanOrEqual(0)
    })

    it(`approaches goal side rather than blindly charging the carrier on side ${side}`,()=>{
      const a=stage(side,{y:7,leadM:8,secondM:19,type:'standard'})
      const press=a.pressers()
      expect(press).toHaveLength(1)
      const activePresser=a.state.players.find(
        p=>p.playerId===press[0].playerId)!
      const approach=pressingApproachTarget(
        activePresser,a.ballPoint,a.team,a.setup)
      expect(press[0].target).toEqual(approach)
      expect((approach.xM-a.ballPoint.xM)*a.team.attackingDirection)
        .toBeLessThan(-1)
      const definition=a.setup.players.find(p=>p.id===activePresser.playerId)!
      const moving=projectPlayerToward(
        activePresser,definition,approach,a.setup.pitch,121)
      expect(Math.hypot(
        moving.position.xM-activePresser.position.xM,
        moving.position.yM-activePresser.position.yM)).toBeLessThan(.25)
      expect(a.state.contactEvents).toHaveLength(0)
      expect(a.state.automaticContactEvents).toHaveLength(0)
    })
  }

  it('keeps the previous suitable presser when a colleague is only slightly closer',()=>{
    const a=stage(0,{x:55,leadM:6,secondM:4,
      type:'standard',previousPress:'RCM'})
    expect(a.pressers()).toHaveLength(1)
    expect(a.pressers()[0].playerId).toBe(a.primary.playerId)
    expect(a.pressers()).toEqual(a.pressers())
    expect(a.state.goalEvents).toHaveLength(0)
  })

  it('switches responsibility when the prior presser is no longer eligible',()=>{
    const a=stage(0,{x:55,leadM:18,secondM:5,
      type:'standard',previousPress:'RCM'})
    expect(a.pressers()).toHaveLength(1)
    expect(a.pressers()[0].playerId).toBe(a.secondary.playerId)
  })

  it('a genuine first touch enables a nearby standard pressing trigger',()=>{
    const before=stage(0,{x:82,leadM:13,secondM:20,type:'standard'})
    const received=stage(0,{x:82,leadM:13,secondM:20,
      type:'standard',justReceived:true})
    expect(before.pressers()).toHaveLength(0)
    expect(received.pressers()).toHaveLength(1)
    expect(received.pressers()[0].playerId).toBe(received.primary.playerId)
  })

  it('does not let pressing intensity suppress physical loose-ball recovery',()=>{
    const a=stage(0,{x:80,leadM:12,secondM:18,
      type:'low',looseBall:true})
    const before=JSON.stringify(a.state)
    const plan=planDefensiveResponsibilities(
      a.state,a.setup,a.team,a.ballPoint,a.primary.playerId)
    expect(plan.get(a.primary.playerId)?.action).toBe('press')
    expect(plan.get(a.primary.playerId)?.engage).toBe(true)
    expect(a.state.ball.controllerId).toBeNull()
    expect(JSON.stringify(a.state)).toBe(before)
  })
})
