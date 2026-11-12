import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { contactAccuracy, kickAngleErrorRange } from '../../src/game/physics/contact'
import { passMeetingPoint, previewPhysicalPass } from '../../src/game/ai/pass-viability'
import { evaluateOnBallChoice, evaluateOnBallPlan } from '../../src/game/ai/possession'
import { activePassIntent, intendedReceiverTarget } from '../../src/game/ai/pass-coordination'
import type { MatchState } from '../../src/game/match/state'

function stagedPass() {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const carrier = initial.players.find(p =>
    p.clubId === setup.clubs[0].id && p.formationSlot === 'ST')!
  const receiver = initial.players.find(p =>
    p.clubId === carrier.clubId && p.formationSlot === 'RCM')!
  const footballer = setup.players.find(p => p.id === carrier.playerId)!
  const players = initial.players.map(p =>
    p.playerId === carrier.playerId ?
      { ...p, position: { xM: 52, yM: 34 }, velocity: {xMps:0,yMps:0} } :
    p.playerId === receiver.playerId ?
      { ...p, position: { xM: 62, yM: 37 }, velocity: {xMps:0,yMps:0} } :
    p.clubId !== carrier.clubId ?
      { ...p, position: {xM:89,yM:p.position.yM} } : p)
  const state:MatchState={...initial,players,
    ai:{...initial.ai,enabledTeams:[true,true]},
    ball:{...initial.ball,position:{xM:52,yM:34},
      controllerId:carrier.playerId,lastTouchPlayerId:carrier.playerId,
      controlOffset:{xM:0,yM:0}},
  }
  return {
    setup,state,carrier:players.find(p=>p.playerId===carrier.playerId)!,
    receiver:players.find(p=>p.playerId===receiver.playerId)!,footballer,
  }
}
describe('Phase 6.9B real receiver connections', () => {
  it('aims a short ground pass at a real footballer rather than unsupported empty space',()=>{
    const {setup,state,carrier,receiver,footballer}=stagedPass()
    const target=passMeetingPoint(receiver,setup)
    expect(target).toEqual(receiver.position)
    const score=previewPhysicalPass(carrier,footballer,receiver,target,
      .28,0,state.ball,setup)
    expect(score.canReceive).toBe(true)
    expect(score.etaSeconds).toBeGreaterThan(.2)
    expect(score.etaSeconds).toBeLessThan(3.2)
    expect(score.uncertaintyM).toBeGreaterThan(0)
    expect(state.ball.controllerId).toBe(carrier.playerId)
    expect(state.contactEvents).toHaveLength(0)
  })
  it('only leads running receivers by physically plausible stopping distance',()=>{
    const {setup,receiver}=stagedPass()
    const fast={...receiver,velocity:{xMps:7,yMps:0}}
    const target=passMeetingPoint(fast,setup)
    expect(target.xM).toBeGreaterThan(receiver.position.xM)
    expect(target.xM).toBeLessThanOrEqual(receiver.position.xM+1.06)
    const nearLine={...fast,position:{xM:92,yM:66},
      velocity:{xMps:4,yMps:6}}
    expect(passMeetingPoint(nearLine,setup).yM).toBeLessThanOrEqual(
      setup.pitch.widthM-3.1)
    expect(passMeetingPoint(nearLine,setup).xM).toBeLessThan(
      setup.pitch.lengthM-3.1)
  })
  it('does not approve a physically unreachable footballer as an automatic receiver',()=>{
    const {setup,state,carrier,receiver,footballer}=stagedPass()
    const impossible={...receiver,position:{xM:102,yM:65}}
    const score=previewPhysicalPass(carrier,footballer,impossible,
      impossible.position,.07,0,state.ball,setup)
    expect(score.canReceive).toBe(false)
  })
  it('penalizes touchline passes more than equal-distance central passes',()=>{
    const {setup,state,carrier,receiver,footballer}=stagedPass()
    const middle={...receiver,position:{xM:62,yM:34}}
    const wide={...receiver,position:{xM:62,yM:64.6}}
    const central=previewPhysicalPass(carrier,footballer,middle,middle.position,
      .3,0,state.ball,setup)
    const touchline=previewPhysicalPass(carrier,footballer,wide,wide.position,
      .7,0,state.ball,setup)
    expect(touchline.safetyPenalty).toBeGreaterThan(central.safetyPenalty)
  })
  it('reduces AI pass execution noise, but preserves a meaningful seeded kick error',()=>{
    const {footballer}=stagedPass()
    const acc=contactAccuracy(footballer,false)
    const normal=kickAngleErrorRange(acc,.3,false,false)
    const ai=kickAngleErrorRange(acc,.3,true,false)
    expect(ai).toBeGreaterThan(.01)
    expect(ai).toBeLessThan(normal)
    expect(kickAngleErrorRange(acc,.3,false,true)).toBe(normal)
    expect(kickAngleErrorRange(acc,.3,true,true)).toBe(normal)
  })
  it('keeps pass planning pure and the same for a fixed seed, including a physical kick target',()=>{
    const {setup,state}=stagedPass()
    const raw=JSON.stringify(state)
    const a=evaluateOnBallPlan(state,setup,true,true)
    const b=evaluateOnBallPlan(state,setup,true,true)
    expect(a).toEqual(b)
    expect(JSON.stringify(state)).toBe(raw)
    const c=evaluateOnBallChoice(state,setup,true,true)
    expect(c).toEqual(a.choice)
    if(c?.kind==='pass') {
      const receiver=state.players.find(p=>p.playerId===c.receiverId)!
      const deviation=Math.hypot(c.target.xM-receiver.position.xM,
        c.target.yM-receiver.position.yM)
      expect(deviation).toBeLessThanOrEqual(1.61)
    }
  })
  it('retargets a kicked ball trajectory if no original meeting interception is possible',()=>{
    const {setup,state,carrier,receiver}=stagedPass()
    const lost:MatchState={
      ...state,
      clock:{...state.clock,tick:24},
      players:state.players.map(p=>p.playerId===receiver.playerId?
        {...p,position:{xM:62,yM:37}}:p),
      ball:{...state.ball,position:{xM:30,yM:20},
        heightM:BALL_RADIUS_M,
        velocity:{xMps:-5,yMps:0,zMps:0},
        controllerId:null,controlOffset:null,lastTouchPlayerId:carrier.playerId},
      ai:{...state.ai,passIntent:{
        commandId:'ai-pass-22-'+carrier.playerId,
        teamId:carrier.clubId,passerId:carrier.playerId,
        receiverId:receiver.playerId,requestedTick:22,target:{xM:62,yM:37},
      }},
      contactEvents:[{
        commandId:'ai-pass-22-'+carrier.playerId,
        playerId:carrier.playerId,tick:23,kind:'kick',outcome:'kicked',drawUsed:1,
      }],
    }
    const intent=activePassIntent(lost)!
    const target=intendedReceiverTarget(lost,setup,intent)
    expect(target.xM).toBeLessThan(40)
    expect(target.yM).toBeLessThan(24)
    expect(target).not.toEqual(intent.target)
  })
  it('maintains genuine physical replay with no synthetic completed passes',()=>{
    const a=new MatchViewerSession(117)
    for(let i=0;i<120&&!a.state.ball.outsidePitch;i++)a.advance(2)
    const clone=restoreFoundationMatch(a.checkpoint())
    clone.advance(6)
    clone.advance(6)
    a.advance(6)
    a.advance(6)
    expect(clone.checkpoint()).toEqual(a.checkpoint())
  })
})
