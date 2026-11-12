import {describe, expect, it} from 'vitest'
import {makeFictionalMatchSetup} from '../fixtures/fictional-match'
import {createFoundationMatch, restoreFoundationMatch} from '../../src/game/match/engine'
import {MatchViewerSession} from '../../src/game/viewer/session'
import {resolveAutomaticBallContact} from '../../src/game/physics/automatic-contact'
import {advanceControlledBall, resolveContactAttempts} from '../../src/game/physics/contact'
import {GOALKEEPER_HAND_HEIGHT_M, GOALKEEPER_HOLD_MIN_TICKS, activeGoalkeeperCatch} from '../../src/game/physics/goalkeeper-handling'
import {chooseGoalkeeperThrow} from '../../src/game/ai/goalkeeper-distribution'
import {canReleaseControlledBall} from '../../src/game/ai/possession'
import {parseMatchCommandRequest} from '../../src/game/match/commands'
import type {MatchState} from '../../src/game/match/state'

function incomingShot(speed: number) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const home = setup.clubs[0].id
  const keeper = initial.players.find(p => p.clubId === home && p.formationSlot === 'GK')!
  const striker = initial.players.find(p => p.clubId !== home && p.formationSlot === 'ST')!
  const players = initial.players.map(p => p.playerId === keeper.playerId ?
    {...p,position:{xM:4.7,yM:34},velocity:{xMps:0,yMps:0},engagesBall:true}
    : {...p,engagesBall:false})
  const before:MatchState = {
    ...initial, kickoff:null, clock:{...initial.clock,tick:23},
    players, ai:{...initial.ai,enabledTeams:[true,true],lastDecisionTick:22},
    ball:{...initial.ball, position:{xM:5.75,yM:34},heightM:1,
      velocity:{xMps:-speed,yMps:0,zMps:0},
      controllerId:null,controlOffset:null,outsidePitch:false,
      lastTouchPlayerId:striker.playerId},
    contactEvents:[{commandId:'ai-shot-test',playerId:striker.playerId,
      kind:'kick',outcome:'kicked',tick:22,drawUsed:1}],
  }
  const after:MatchState = {...before,clock:{...before.clock,tick:24},
    ball:{...before.ball,position:{xM:5.32,yM:34}}}
  return {setup,before,after,keeper}
}

describe('Phase 6.9E real goalkeeper catches, parries and held-ball release',()=>{
  it('holds a manageable physical shot with gloved hands, not as a foot touch',()=>{
    const {setup,before,after,keeper}=incomingShot(8)
    const raw=JSON.stringify(before)
    const result=resolveAutomaticBallContact(before,after,setup)
    expect(result.automaticContactEvents.at(-1)?.outcome).toBe('caught')
    expect(result.ball.controllerId).toBe(keeper.playerId)
    expect(result.ball.heightM).toBe(GOALKEEPER_HAND_HEIGHT_M)
    expect(activeGoalkeeperCatch(result)?.tick).toBe(24)
    expect(canReleaseControlledBall(result,setup)).toBe(false)
    const moving={...keeper,position:{xM:5,yM:34}}
    const held=advanceControlledBall(result.ball,moving,setup.pitch)
    expect(held.heightM).toBe(GOALKEEPER_HAND_HEIGHT_M)
    expect(held.position.xM).toBeCloseTo(moving.position.xM+result.ball.controlOffset!.xM)
    expect(JSON.stringify(before)).toBe(raw)
  })
  it('physically parries a fast shot instead of falsely claiming clean possession',()=>{
    const {setup,before,after,keeper}=incomingShot(31)
    const result=resolveAutomaticBallContact(before,after,setup)
    expect(result.automaticContactEvents.at(-1)?.outcome).toBe('parried')
    expect(result.automaticContactEvents.at(-1)?.playerId).toBe(keeper.playerId)
    expect(result.ball.controllerId).toBeNull()
    expect(result.ball.lastTouchPlayerId).toBe(keeper.playerId)
    expect(result.ball.velocity.xMps).not.toBe(before.ball.velocity.xMps)
  })
  it('keeps the ball in hands until a physically resolved, aimed throw',()=>{
    const {setup,before,after,keeper}=incomingShot(8)
    const held=resolveAutomaticBallContact(before,after,setup)
    const request={commandId:'ai-pass-throw-test',type:'attemptGoalkeeperThrow' as const,
      teamId:keeper.clubId,playerId:keeper.playerId,
      target:{xM:22,yM:35},power:.55}
    expect('request' in parseMatchCommandRequest(request,setup.pitch)).toBe(true)
    const tooSoon:MatchState={...held,clock:{...held.clock,tick:30},
      appliedCommands:[{...request,requestedTick:29,targetTick:30,
        appliedTick:30,sequence:1}]}
    const premature=resolveContactAttempts(tooSoon,setup)
    expect(premature.contactEvents.at(-1)?.outcome).toBe('tooSoon')
    expect(premature.ball.controllerId).toBe(keeper.playerId)
    const ready:MatchState={...held,clock:{...held.clock,tick:24+GOALKEEPER_HOLD_MIN_TICKS},
      appliedCommands:[{...request,requestedTick:24+GOALKEEPER_HOLD_MIN_TICKS-1,
        targetTick:24+GOALKEEPER_HOLD_MIN_TICKS,
        appliedTick:24+GOALKEEPER_HOLD_MIN_TICKS,sequence:1}]}
    const released=resolveContactAttempts(ready,setup)
    expect(released.contactEvents.at(-1)?.outcome).toBe('thrown')
    expect(released.ball.controllerId).toBeNull()
    expect(released.ball.heightM).toBe(GOALKEEPER_HAND_HEIGHT_M)
    expect(released.ball.velocity.zMps).toBeGreaterThan(0)
    expect(released.ball.velocity.xMps).toBeGreaterThan(0)
    expect(activeGoalkeeperCatch(released)).toBeNull()
    expect(released.contactEvents.at(-1)?.drawUsed).toBe(1)
  })
  it('plans a bounded, delayed outlet only after a real catch',()=>{
    const {setup,before,after,keeper}=incomingShot(8)
    const held=resolveAutomaticBallContact(before,after,setup)
    expect(chooseGoalkeeperThrow(held,setup)).toBeNull()
    const later:MatchState={...held,clock:{...held.clock,tick:100}}
    const a=chooseGoalkeeperThrow(later,setup)
    expect(a?.kind).toBe('throw')
    expect(a?.playerId).toBe(keeper.playerId)
    expect(a?.receiverId).not.toBe(keeper.playerId)
    expect(a!.power).toBeGreaterThanOrEqual(.05)
    expect(a!.power).toBeLessThanOrEqual(1)
    expect(chooseGoalkeeperThrow(later,setup)).toEqual(a)
  })
  it('makes a goalkeeper assess a foot-level first touch before passing',()=>{
    const {setup,before,keeper}=incomingShot(8)
    const keeperFeet:MatchState={...before,clock:{...before.clock,tick:26},
      ball:{...before.ball,heightM:.11,
        position:{...keeper.position},velocity:{xMps:0,yMps:0,zMps:0},
        controllerId:keeper.playerId,controlOffset:{xM:0,yM:0},
        lastTouchPlayerId:keeper.playerId},
      automaticContactEvents:[{
        playerId:keeper.playerId,tick:24,kind:'interception',
        outcome:'intercepted',contactFraction:0,
      }],
    }
    expect(canReleaseControlledBall(keeperFeet,setup)).toBe(false)
    const later={...keeperFeet,clock:{...keeperFeet.clock,tick:48}}
    expect(canReleaseControlledBall(later,setup)).toBe(true)
  })
  it('restores a genuinely caught live shot and the later thrown ball identically',()=>{
    const session=new MatchViewerSession(42)
    for(let i=0;i<1100 && !session.state.ball.outsidePitch &&
      !session.state.automaticContactEvents.some(e=>e.outcome==='caught');i++) {
      session.advance(1)
    }
    expect(session.state.automaticContactEvents.some(e=>e.outcome==='caught')).toBe(true)
    expect(activeGoalkeeperCatch(session.state)).not.toBeNull()
    const restored=restoreFoundationMatch(session.checkpoint())
    expect(restored.checkpoint()).toEqual(session.checkpoint())
    // The saved, hands-held ball must remain an actual physical controller
    // until a validated throw is executed after the hold period.
    for(let i=0;i<90 && !session.state.ball.outsidePitch;i++){
      restored.advance(1)
      session.advance(1)
      expect(restored.checkpoint()).toEqual(session.checkpoint())
    }
    expect(session.state.contactEvents.some(e=>e.outcome==='thrown')).toBe(true)
  })
  it('preserves checkpoint replay of unmodified matches',()=>{
    const setup=makeFictionalMatchSetup()
    const engine=createFoundationMatch(setup)
    engine.advance(150)
    const cp=engine.checkpoint()
    expect(restoreFoundationMatch(cp).checkpoint()).toEqual(cp)
  })
})
