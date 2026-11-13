import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { evaluateOnBallPlan } from '../../src/game/ai/possession'
import {
  evaluateShootingOpportunity, shootingCorridorObstruction,
} from '../../src/game/ai/goal-directed'
import type { MatchState } from '../../src/game/match/state'

/**
 * Stable, mirrored constructed scenes — not player match data or assumed
 * success. Run this EXACT test against the prior engine for a fair measure
 * of opportunity decisions. Does not award or generate any goal.
 */
describe('Compare seeded on-ball decisions at constructed clear shooting chances',()=>{
  it('records actual shoot/pass/carry decisions without fabricating goals',()=>{
    const setup=makeFictionalMatchSetup()
    const initial=createFoundationMatch(setup).getState()
    const results:{
      side:number;distanceM:number;lateralM:number;
      clearance:number;choice:string;progress:number;
    }[]=[]
    for(const side of [0,1] as const) {
      const team=initial.teams[side]
      const forward=team.attackingDirection
      const shooter=initial.players.find(p=>
        p.clubId===team.clubId&&p.formationSlot==='ST')!
      const back=initial.players.find(p=>
        p.clubId===team.clubId&&p.formationSlot==='DM')!
      const opponent=initial.teams[1-side].clubId
      for(const distanceM of [8,12,16,20,24]) {
        for(const lateralM of [-7,0,7]) {
          for(const keeperSide of [-3,3]) {
            for(const behind of [8,15]) {
              const point={xM:forward===1
                ? setup.pitch.lengthM-distanceM : distanceM,
                yM:setup.pitch.widthM/2+lateralM}
              const players=initial.players.map(p=>{
                const position=p.playerId===shooter.playerId?point:
                  p.playerId===back.playerId
                  ? {xM:point.xM-forward*behind,
                    yM:point.yM+(lateralM>0?-5:5)}
                  : p.clubId===opponent
                    ? p.formationSlot==='GK'
                      ? {xM:forward===1
                        ? setup.pitch.lengthM-2.8:2.8,
                        yM:setup.pitch.widthM/2+keeperSide}
                      : {xM:forward===1?50:55,
                        yM:p.position.yM<34?7:61}
                    : p.position
                return {...p,position,velocity:{xMps:0,yMps:0},
                  orientationRad:p.playerId===shooter.playerId?
                    forward===1?0:Math.PI:p.orientationRad}
              })
              const state:MatchState={...initial,players,kickoff:null,
                clock:{...initial.clock,tick:120},
                ball:{...initial.ball,position:point,heightM:.11,
                  controllerId:shooter.playerId,
                  controlOffset:{xM:0,yM:0},
                  lastTouchPlayerId:shooter.playerId,
                  velocity:{xMps:0,yMps:0,zMps:0}},
                ai:{...initial.ai,enabledTeams:[true,true],lastPassTick:-1000},
              }
              const current=players.find(p=>p.playerId===shooter.playerId)!
              const definition=setup.players.find(p=>p.id===shooter.playerId)!
              const opposition=players.filter(p=>p.clubId===opponent)
              const opportunity=evaluateShootingOpportunity(
                current,definition,opposition,team,setup)
              if(!opportunity||opportunity.chanceQuality<.24||
                  shootingCorridorObstruction(
                    current.position,opportunity.target,opposition)>=1.8)
                continue
              const action=evaluateOnBallPlan(state,setup,true,true).choice
              const receiver=action?.kind==='pass'
                ? players.find(p=>p.playerId===action.receiverId)
                : undefined
              const progress=receiver
                ? (receiver.position.xM-current.position.xM)*forward : 0
              results.push({
                side,distanceM,lateralM,
                clearance:opportunity.chanceQuality,
                choice:action?.kind??'none',
                progress,
              })
              expect(state.goalEvents).toHaveLength(0)
              expect(state.contactEvents).toHaveLength(0)
            }
          }
        }
      }
    }
    const backward=results.filter(r=>r.choice==='pass'&&r.progress< -2.5)
    console.info('[O11 CLEAR SHOT DECISION BASELINE] '+JSON.stringify({
      source:'constructed fictional scenes; NO match outcomes or goals',
      n:results.length,
      shot:results.filter(r=>r.choice==='shoot').length,
      carry:results.filter(r=>r.choice==='carry').length,
      pass:results.filter(r=>r.choice==='pass').length,
      backwardPass:backward.length,
      byDistance:[8,12,16,20,24].map(distanceM=>({
        distanceM,
        n:results.filter(r=>r.distanceM===distanceM).length,
        shot:results.filter(r=>r.distanceM===distanceM&&r.choice==='shoot').length,
        backward:backward.filter(r=>r.distanceM===distanceM).length,
      })),
    }))
    expect(results.length).toBeGreaterThan(40)
  },30000)
})
