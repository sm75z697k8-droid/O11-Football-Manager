import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { resolveAutomaticBallContact } from '../../src/game/physics/automatic-contact'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { runAutonomousDecisions } from '../../src/game/ai/runner'
import type { MatchState } from '../../src/game/match/state'
import type { MatchSetup } from '../../src/game/model/match'

function scene() {
  const fixture = makeFictionalMatchSetup()
  const ownerId = fixture.teams[0].starters.find(p=>p.slot==='ST')!.playerId
  const weakId = fixture.teams[1].starters.find(p=>p.slot==='ST')!.playerId
  const strongId = fixture.teams[1].starters.find(p=>p.slot==='DM')!.playerId
  const definitions = fixture.players.map(p=> {
    if (p.id === ownerId) return {...p,abilities:{
      ...p.abilities,
      technical:{...p.abilities.technical,dribbling:98},
      physical:{...p.abilities.physical,balance:98,strength:98},
      mental:{...p.abilities.mental,composure:98},
    }}
    if (p.id === weakId) return {...p,abilities:{
      ...p.abilities,
      technical:{...p.abilities.technical,tackling:8},
      physical:{...p.abilities.physical,balance:8,strength:8},
      mental:{...p.abilities.mental,anticipation:8},
    }}
    if (p.id === strongId) return {...p,abilities:{
      ...p.abilities,
      technical:{...p.abilities.technical,tackling:100},
      physical:{...p.abilities.physical,balance:100,strength:100},
      mental:{...p.abilities.mental,anticipation:100},
    }}
    return p
  })
  const setup: MatchSetup = {...fixture,players:definitions}
  const base = createFoundationMatch(setup).getState()
  const players=base.players.map(p=>{
    if (p.playerId===ownerId) return {...p,
      position:{xM:50,yM:34},velocity:{xMps:0,yMps:0},
      engagesBall:false}
    if (p.playerId===weakId) return {...p,
      position:{xM:50.5,yM:34},velocity:{xMps:0,yMps:0},
      engagesBall:true}
    return {...p,engagesBall:false}
  })
  const state: MatchState={...base,players,kickoff:null,
    ball:{...base.ball,controllerId:ownerId,
      controlOffset:{xM:.08,yM:0},lastTouchPlayerId:ownerId,
      position:{xM:50.08,yM:34},heightM:BALL_RADIUS_M,
      velocity:{xMps:0,yMps:0,zMps:0},outsidePitch:false},
  }
  return {state,setup,ownerId,weakId,strongId}
}

function oneTick(state: MatchState, setup: MatchSetup): MatchState {
  const after = {...state,clock:{...state.clock,tick:state.clock.tick+1}}
  return resolveAutomaticBallContact(state,after,setup)
}

describe('Phase 6.9I — failed-challenge collision de-duplication',()=>{
  it('records one genuine held-off challenge, not an infinite contact loop while static',()=>{
    const {setup,weakId,ownerId,state}=scene()
    let s=state
    for(let n=0;n<100;n++)s=oneTick(s,setup)
    expect(s.clock.tick).toBe(100)
    expect(s.ball.controllerId).toBe(ownerId)
    expect(s.automaticContactEvents).toHaveLength(1)
    expect(s.automaticContactEvents[0]).toMatchObject({
      playerId:weakId,kind:'challenge',outcome:'heldOff',
    })
    expect(s.ball.position).toEqual(state.ball.position)
    expect(s.ballContactCooldownUntilTick).toBe(7)
  })
  it('allows a fresh physically entered challenge after the defender separates',()=>{
    const {setup,weakId,state}=scene()
    let s=state
    for(let n=0;n<18;n++)s=oneTick(s,setup)
    expect(s.automaticContactEvents).toHaveLength(1)
    // A new approach begins outside foot-contact reach at the old tick.
    // 14cm of movement in 50ms is a plausible 2.8m/s re-entry.
    const outside:MatchState={...s,players:s.players.map(p=>
      p.playerId===weakId ? {...p,position:{xM:51.16,yM:34},
        velocity:{xMps:-2.8,yMps:0}} : p)}
    const inside:MatchState={...outside,
      clock:{...outside.clock,tick:outside.clock.tick+1},
      players:outside.players.map(p=>p.playerId===weakId
        ? {...p,position:{xM:51.02,yM:34}} : p)}
    const again=resolveAutomaticBallContact(outside,inside,setup)
    expect(again.automaticContactEvents).toHaveLength(2)
    expect(again.automaticContactEvents[1].outcome).toBe('heldOff')
  })
  it('keeps another defender able to win real possession after the first was held off',()=>{
    const {state,setup,strongId,ownerId}=scene()
    const once=oneTick(state,setup)
    expect(once.automaticContactEvents[0].outcome).toBe('heldOff')
    const outside:MatchState={...once,
      clock:{...once.clock,tick:once.clock.tick+6},
      players:once.players.map(p=>p.playerId===strongId
        ? {...p,position:{xM:51.18,yM:34},
          velocity:{xMps:-3.6,yMps:0},engagesBall:true} : p)}
    const inside:MatchState={...outside,
      clock:{...outside.clock,tick:outside.clock.tick+1},
      players:outside.players.map(p=>p.playerId===strongId
        ? {...p,position:{xM:51,yM:34}} : p)}
    const contested=resolveAutomaticBallContact(outside,inside,setup)
    expect(contested.automaticContactEvents).toHaveLength(2)
    expect(contested.automaticContactEvents[1].playerId).toBe(strongId)
    expect(contested.automaticContactEvents[1].outcome).toBe('wonChallenge')
    expect(contested.ball.controllerId).not.toBe(ownerId)
    expect(contested.ball.controllerId).toBe(strongId)
  })
  it('reconsiders possession promptly under genuine pressure without requiring contact spam',()=>{
    const {state,setup,weakId}=scene()
    const blocked=oneTick(state,setup)
    expect(blocked.automaticContactEvents.at(-1)?.outcome).toBe('heldOff')
    const current:MatchState={...blocked,
      clock:{...blocked.clock,tick:7},
      // The real contact at tick 1 has already triggered its normal AI
      // refresh. At tick 7, only the unresolved-contest gate can shorten
      // the regular 12-tick interval.
      ai:{...blocked.ai,enabledTeams:[true,true],lastDecisionTick:1},
    }
    const update=runAutonomousDecisions(current,setup)
    expect(update.ai.lastDecisionTick).toBe(7)
    expect(update.ball.controllerId).toBe(state.ball.controllerId)
    // If the defender is far away, the regular 12-tick decision pacing
    // remains. The shorter interval is NOT a global pass-spam timer.
    const unpressured:MatchState={...current,
      players:current.players.map(p=>p.playerId===weakId
        ? {...p,position:{xM:72,yM:52},engagesBall:false} : p),
    }
    const slow=runAutonomousDecisions(unpressured,setup)
    expect(slow.ai.lastDecisionTick).toBe(1)
    expect(slow.contactEvents).toHaveLength(0)
  })
  it('both autonomous sides remain enabled and interpolation advances real ticks',()=>{
    const game=new MatchViewerSession(90)
    game.advance(8)
    expect(game.state.ai.enabledTeams).toEqual([true,true])
    expect(game.previous.clock.tick).toBe(7)
    expect(game.state.clock.tick).toBe(8)
    expect(game.state.players).toHaveLength(22)
    expect(game.state.contactEvents[0].outcome).toBe('kicked')
  })
})
