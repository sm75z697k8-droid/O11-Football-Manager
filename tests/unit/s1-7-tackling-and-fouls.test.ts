import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { applyDueMatchCommands, scheduleMatchCommand } from '../../src/game/match/commands'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import {
  assessBodyChallenge, sweptBodyEntry, adjudicatePhysicalFoul,
  stageFoulRestart, advanceFoulRestart, foulRestartPlayersLegal,
  foulKickPrefix, insideDefendingPenaltyArea,
} from '../../src/game/match/fouls'
import type { MatchState } from '../../src/game/match/state'

function collision(direction:1|-1=1, penalty=false){
  const setup=makeFictionalMatchSetup()
  const base=createFoundationMatch(setup).getState()
  const attack=base.teams.find(t=>t.attackingDirection===direction)!
  const defence=base.teams.find(t=>t.clubId!==attack.clubId)!
  const carrier=base.players.find(p=>p.clubId===attack.clubId &&
    p.formationSlot==='ST')!
  const defender=base.players.find(p=>p.clubId===defence.clubId &&
    p.formationSlot==='RCB')!
  const x=direction===1
    ? penalty?96:60 : penalty?9:45
  const a={xM:x,yM:setup.pitch.widthM/2}
  const before:MatchState={...base,clock:{...base.clock,tick:100},
    kickoff:null,
    ball:{...base.ball,controllerId:carrier.playerId,
      lastTouchPlayerId:carrier.playerId,
      position:{xM:x,yM:a.yM},heightM:BALL_RADIUS_M,
      controlOffset:{xM:0,yM:0}},
    players:base.players.map(p=>
      p.playerId===carrier.playerId?{
        ...p,position:a,orientationRad:direction===1?0:Math.PI,
        velocity:{xMps:0,yMps:0},engagesBall:true,
      }:p.playerId===defender.playerId?{
        ...p,position:{xM:x-direction*1.22,yM:a.yM},
        velocity:{xMps:direction*6,yMps:0},engagesBall:true,
      }:p),
  }
  const after:MatchState={...before,
    clock:{...before.clock,tick:101},
    players:before.players.map(p=>p.playerId===defender.playerId
      ? {...p,position:{xM:x-direction*.68,yM:a.yM}}
      :p),
    ai:{...before.ai,decisionSnapshot:[{
      playerId:defender.playerId,clubId:defence.clubId,
      action:'press',engage:true,target:a,tick:101,
    }]},
  }
  return {setup,before,after,attack,defence,carrier,defender}
}
function foulScene(direction:1|-1=1,penalty=false){
  const s=collision(direction,penalty)
  const whistled=adjudicatePhysicalFoul(s.before,s.after,s.setup)
  return {...s,whistled}
}
function positionedForRestart(state:MatchState,setup:ReturnType<typeof makeFictionalMatchSetup>){
  const initial:MatchState={...state,
    ai:{...state.ai,enabledTeams:[true,true]}}
  const staged=stageFoulRestart(initial,setup)
  return {...staged,
    clock:{...staged.clock,tick:staged.clock.tick+30},
    players:staged.players.map(p=>p.intention.kind==='moveToPoint'
      ? {...p,position:{...p.intention.target},
        velocity:{xMps:0,yMps:0}}
      :p),
  }
}

describe('S1.7 physical tackling, fouls and real referee restarts',()=>{
  it('detects first swept body entry, but does not retrigger a standing overlap',()=>{
    expect(sweptBodyEntry({xM:1.22,yM:0},{xM:.67,yM:0},
      {xM:0,yM:0},{xM:0,yM:0})).toBeCloseTo(
        (1.22-.86)/(.55),5)
    expect(sweptBodyEntry({xM:.5,yM:0},{xM:.4,yM:0},
      {xM:0,yM:0},{xM:0,yM:0})).toBeNull()
    expect(sweptBodyEntry({xM:2,yM:0},{xM:2.4,yM:0},
      {xM:0,yM:0},{xM:0,yM:0})).toBeNull()
  })
  it('evaluates real pressing contact and the carrier orientation in either direction',()=>{
    for(const dir of [1,-1] as const){
      const s=collision(dir)
      const challenge=assessBodyChallenge(s.before,s.after,s.setup)
      expect(challenge?.defenderId).toBe(s.defender.playerId)
      expect(challenge?.carrierId).toBe(s.carrier.playerId)
      expect(challenge?.angle).toBe('behind')
      expect(challenge?.impactSpeedMps).toBeCloseTo(6)
      expect(challenge?.foul).toBe(true)
      const fouled=adjudicatePhysicalFoul(s.before,s.after,s.setup)
      expect(fouled.foulEvents).toHaveLength(1)
      expect(fouled.foulEvents[0].awardedTeamId).toBe(s.attack.clubId)
      expect(fouled.foulRestart?.kind).toBe('directFreeKick')
      expect(fouled.ball.velocity).toEqual({xMps:0,yMps:0,zMps:0})
      expect(fouled.ball.controllerId).toBeNull()
    }
  })
  it('does not invent fouls for clean ball wins or accidental off-ball crowding',()=>{
    const s=collision()
    expect(assessBodyChallenge(s.before,{
      ...s.after,
      automaticContactEvents:[{
        tick:101,playerId:s.defender.playerId,kind:'challenge',
        outcome:'wonChallenge',contactFraction:.5,
      }],
    },s.setup)).toBeNull()
    const crowd:MatchState={...s.after,
      players:s.after.players.map(p=>p.playerId===s.defender.playerId
        ? {...p,engagesBall:false}:p)}
    expect(assessBodyChallenge(s.before,crowd,s.setup)).toBeNull()
    expect(adjudicatePhysicalFoul(s.before,crowd,s.setup).foulEvents)
      .toHaveLength(0)
  })
  it('uses the defending penalty area and an actual 11m penalty mark',()=>{
    for(const dir of [1,-1] as const){
      const s=foulScene(dir,true)
      const ev=s.whistled.foulRestart!
      expect(ev.kind).toBe('penalty')
      expect(ev.ballSpot.xM).toBe(dir===1?94:11)
      expect(ev.ballSpot.yM).toBe(s.setup.pitch.widthM/2)
      expect(insideDefendingPenaltyArea(ev.spot,s.defence.clubId,
        s.whistled,s.setup)).toBe(true)
      expect(s.whistled.teams.map(t=>t.score)).toEqual([0,0])
    }
  })
  it('rejects unauthorized kicks; free kick uses the existing real contact physics',()=>{
    const s=foulScene()
    const ev=s.whistled.foulRestart!
    const fake=scheduleMatchCommand(s.whistled,{
      commandId:'normal-kick',teamId:ev.awardedTeamId,
      type:'attemptKick',playerId:ev.takerId,
      target:{xM:55,yM:30},power:.38,lift:0,
    },s.setup.pitch)
    expect(fake.receipt.accepted).toBe(false)
    const ready=positionedForRestart(s.whistled,s.setup)
    expect(foulRestartPlayersLegal(ready,s.setup)).toBe(true)
    const pending=stageFoulRestart(ready,s.setup)
    expect(pending.pendingCommands.some(c=>c.commandId.startsWith(
      foulKickPrefix(ev)))).toBe(true)
    const due=applyDueMatchCommands({...pending,
      clock:{...pending.clock,tick:pending.clock.tick+1}})
    const resumed=advanceFoulRestart(due,s.setup,resolveContactAttempts)
    expect(resumed.contactEvents.at(-1)?.outcome).toBe('kicked')
    expect(resumed.foulRestart).toBeNull()
    expect(Math.hypot(resumed.ball.velocity.xMps,
      resumed.ball.velocity.yMps)).toBeGreaterThan(2)
  })
  it('prepares a real goalkeeper and outfield clearance for a physical penalty',()=>{
    const s=foulScene(1,true)
    const ready=positionedForRestart(s.whistled,s.setup)
    expect(foulRestartPlayersLegal(ready,s.setup)).toBe(true)
    const pending=stageFoulRestart(ready,s.setup)
    expect(pending.pendingCommands.some(c=>c.commandId.startsWith(
      foulKickPrefix(s.whistled.foulRestart!)))).toBe(true)
    const due=applyDueMatchCommands({...pending,
      clock:{...pending.clock,tick:pending.clock.tick+1}})
    const resumed=advanceFoulRestart(due,s.setup,resolveContactAttempts)
    expect(resumed.contactEvents.at(-1)?.outcome).toBe('kicked')
    expect(resumed.foulRestart).toBeNull()
    expect(resumed.ball.lastTouchPlayerId).toBe(
      s.whistled.foulRestart!.takerId)
    expect(resumed.teams.map(t=>t.score)).toEqual([0,0])
  })
  it('retains the same referee outcome for repeated deterministic snapshots',()=>{
    const s=collision(-1,true)
    expect(adjudicatePhysicalFoul(s.before,s.after,s.setup)).toEqual(
      adjudicatePhysicalFoul(s.before,s.after,s.setup))
  })
})
