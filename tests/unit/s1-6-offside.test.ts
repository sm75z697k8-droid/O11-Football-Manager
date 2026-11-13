import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { applyDueMatchCommands, scheduleMatchCommand } from '../../src/game/match/commands'
import {
  applyOffsideLaw, isOffsidePosition, offsideSnapshot,
  secondLastOpponentX, stageOffsideRestart, advanceOffsideRestart,
  offsideOpponentsClear, offsideKickPrefix,
} from '../../src/game/match/offside'
import { adjudicatePhysicalGoal } from '../../src/game/match/goals'
import type { MatchState, ContactEvent } from '../../src/game/match/state'

function positioned(direction:1|-1=1) {
  const setup=makeFictionalMatchSetup()
  const base=createFoundationMatch(setup).getState()
  const team=base.teams.find(t=>t.attackingDirection===direction)!
  const opponent=base.teams.find(t=>t.clubId!==team.clubId)!
  const own=base.players.filter(p=>p.clubId===team.clubId)
  const others=base.players.filter(p=>p.clubId!==team.clubId)
  const passer=own.find(p=>p.formationSlot==='RCM')!
  const receiver=own.find(p=>p.formationSlot==='ST')!
  const x=(forward:number)=>direction===1?forward:setup.pitch.lengthM-forward
  const players=base.players.map(p=>{
    const spot=p.playerId===passer.playerId?{xM:x(49),yM:34}:
      p.playerId===receiver.playerId?{xM:x(78),yM:34}:
      p.clubId===opponent.clubId
        ? {xM:x(p.playerId===others[0].playerId?90:64),yM:10+(p.shirtNumber%9)*5}
        :{xM:x(40),yM:8+(p.shirtNumber%9)*5}
    return {...p,position:spot,velocity:{xMps:0,yMps:0}}
  })
  const before:MatchState={
    ...base, clock:{...base.clock,tick:100},players,
    ball:{...base.ball,position:{xM:x(49),yM:34},
      heightM:BALL_RADIUS_M,controllerId:null,controlOffset:null,
      lastTouchPlayerId:passer.playerId,
      velocity:{xMps:0,yMps:0,zMps:0}},
  }
  const shot:ContactEvent={
    commandId:'physical-pass',playerId:passer.playerId,tick:101,
    kind:'kick',outcome:'kicked',drawUsed:1,
  }
  const after:MatchState={...before,
    clock:{...before.clock,tick:101},
    contactEvents:[shot],
  }
  return {setup,before,after,passer,receiver,opponent,team,x}
}
function withOffside(direction:1|-1=1) {
  const scene=positioned(direction)
  const played=applyOffsideLaw(scene.before,scene.after,scene.setup)
  const touch:ContactEvent={
    commandId:'physical-reception',playerId:scene.receiver.playerId,
    tick:105,kind:'control',outcome:'controlled',drawUsed:1,
  }
  const contacted:MatchState={
    ...played,clock:{...played.clock,tick:105},
    ball:{...played.ball,lastTouchPlayerId:scene.receiver.playerId},
    contactEvents:[...played.contactEvents,touch],
  }
  return {...scene,played,contacted}
}

describe('S1.6 Law 11 real-touch offside',()=>{
  it('uses the ball, half-way line and SECOND-LAST opponent in either direction',()=>{
    for(const direction of [1,-1] as const){
      const s=positioned(direction)
      expect(secondLastOpponentX(s.before,s.team.clubId)).toBeCloseTo(s.x(64))
      const receiver=s.before.players.find(p=>p.playerId===s.receiver.playerId)!
      expect(isOffsidePosition(s.before,s.setup,s.team.clubId,
        receiver.position,s.before.ball.position)).toBe(true)
      expect(isOffsidePosition(s.before,s.setup,s.team.clubId,
        {xM:s.x(64),yM:34},s.before.ball.position)).toBe(false)
      expect(isOffsidePosition(s.before,s.setup,s.team.clubId,
        {xM:s.x(49),yM:34},s.before.ball.position)).toBe(false)
      expect(isOffsidePosition(s.before,s.setup,s.team.clubId,
        {xM:s.x(50),yM:34},{xM:s.x(51),yM:34})).toBe(false)
      expect(isOffsidePosition(s.before,s.setup,s.team.clubId,
        {xM:s.x(50),yM:34},{xM:s.x(49),yM:34})).toBe(false)
    }
  })
  it('records a position, but only WHISTLES for a later real attacker touch',()=>{
    for(const direction of [1,-1] as const){
      const s=withOffside(direction)
      expect(s.played.offsidePhase?.playerIds).toContain(s.receiver.playerId)
      expect(s.played.offsideEvents).toHaveLength(0)
      expect(s.played.offsideRestart).toBeNull()
      const judged=applyOffsideLaw(s.played,s.contacted,s.setup)
      expect(judged.offsideEvents).toHaveLength(1)
      expect(judged.offsideEvents[0].playedTick).toBe(101)
      expect(judged.offsideEvents[0].offenderId).toBe(s.receiver.playerId)
      expect(judged.offsideRestart?.awardedTeamId).toBe(s.opponent.clubId)
      expect(judged.ball.controllerId).toBeNull()
      expect(judged.ball.velocity.xMps).toBe(0)
      expect(judged.ball.velocity.yMps).toBe(0)
      expect(judged.ball.heightM).toBe(BALL_RADIUS_M)
      expect(applyOffsideLaw(s.played,s.contacted,s.setup)).toEqual(judged)
    }
  })
  it('does not call offside for direct throw-ins, goal kicks or corners',()=>{
    const s=positioned()
    for(const [kind,outcome] of [
      ['throwIn','thrownIn'],['goalKick','goalKicked'],
      ['cornerKick','cornerKicked'],
    ] as const){
      const played:MatchState={...s.after,contactEvents:[
        {...s.after.contactEvents[0],kind,outcome},
      ]}
      const result=applyOffsideLaw(s.before,played,s.setup)
      expect(result.offsidePhase).toBeNull()
      const next:MatchState={...result,
        clock:{...result.clock,tick:105},
        contactEvents:[...result.contactEvents,{
          commandId:'receive-'+kind,tick:105,
          playerId:s.receiver.playerId,kind:'control',outcome:'controlled',
          drawUsed:1 as const,
        }],
      }
      expect(applyOffsideLaw(result,next,s.setup).offsideEvents).toHaveLength(0)
    }
  })
  it('keeps an offside phase through an accidental defender deflection, not deliberate possession',()=>{
    const s=withOffside()
    const defender=s.played.players.find(p=>p.clubId===s.opponent.clubId)!
    const deflected:MatchState={...s.played,
      clock:{...s.played.clock,tick:102},
      automaticContactEvents:[{
        tick:102,playerId:defender.playerId,kind:'interception',
        outcome:'deflected',contactFraction:.4,
      }],
    }
    const kept=applyOffsideLaw(s.played,deflected,s.setup)
    expect(kept.offsidePhase?.playerIds).toContain(s.receiver.playerId)
    const won:MatchState={...s.played,clock:{...s.played.clock,tick:102},
      automaticContactEvents:[{
        tick:102,playerId:defender.playerId,kind:'interception',
        outcome:'intercepted',contactFraction:.4,
      }],
    }
    const cleared=applyOffsideLaw(s.played,won,s.setup)
    expect(cleared.offsidePhase?.attackingTeamId).toBe(s.opponent.clubId)
    expect(cleared.offsidePhase?.playerIds).not.toContain(s.receiver.playerId)
  })
  it('requires a legal physical indirect free kick rather than giving free possession',()=>{
    const s=withOffside()
    const dead=applyOffsideLaw(s.played,s.contacted,s.setup)
    const refused=scheduleMatchCommand(dead,{
      commandId:'illegal-pass',type:'attemptKick',teamId:s.opponent.clubId,
      playerId:dead.offsideRestart!.takerId,
      target:{xM:s.x(45),yM:34},power:.34,lift:0,
    },s.setup.pitch)
    expect(refused.receipt.accepted).toBe(false)
    const taker=dead.players.find(p=>p.playerId===dead.offsideRestart!.takerId)!
    const ready:MatchState={...dead,
      clock:{...dead.clock,tick:dead.clock.tick+30},
      players:dead.players.map(p=>{
        if(p.playerId===taker.playerId)return {...p,
          position:{xM:dead.ball.position.xM-
            s.opponent.attackingDirection*.5,yM:dead.ball.position.yM},
          velocity:{xMps:0,yMps:0}}
        if(p.clubId!==s.opponent.clubId)return {...p,
          position:{xM:s.x(30),yM:p.position.yM}}
        return p
      }),
      ai:{...dead.ai,enabledTeams:[true,true]},
    }
    expect(offsideOpponentsClear(ready,s.setup)).toBe(true)
    const stage=stageOffsideRestart(ready,s.setup)
    expect(stage.pendingCommands.filter(c=>c.commandId.startsWith(
      offsideKickPrefix(dead.offsideRestart!.tick)))).toHaveLength(1)
    const pending=stage.pendingCommands.at(-1)!
    const actual=applyDueMatchCommands({
      ...stage,clock:{...stage.clock,tick:stage.clock.tick+1},
    })
    // The same physical contact resolver used for ordinary kicked passes.
    const contacted=resolveContactAttempts(actual,s.setup)
    expect(contacted.contactEvents.at(-1)?.commandId).toBe(pending.commandId)
    expect(contacted.contactEvents.at(-1)?.outcome).toBe('kicked')
    const restarted=advanceOffsideRestart(actual,s.setup,resolveContactAttempts)
    expect(restarted.offsideRestart).toBeNull()
    expect(restarted.indirectFreeKick?.takerId).toBe(taker.playerId)
    expect(restarted.ball.controllerId).toBeNull()
    expect(restarted.ball.velocity.xMps).not.toBe(0)
  })
  it('does not count a direct goal from an untouched indirect free kick',()=>{
    const s=withOffside()
    const setup=s.setup
    const scene:MatchState={...s.played,
      indirectFreeKick:{takerId:s.passer.playerId,kickedTick:100},
      ball:{...s.played.ball,lastTouchPlayerId:s.passer.playerId},
    }
    const after:MatchState={...scene,
      clock:{...scene.clock,tick:110},
      ball:{...scene.ball,position:{xM:setup.pitch.lengthM+.2,
        yM:setup.pitch.widthM/2}},
    }
    const decided=adjudicatePhysicalGoal(scene,after,setup)
    expect(decided.goalEvents).toHaveLength(0)
    expect(decided.teams.map(t=>t.score)).toEqual([0,0])
  })
  it('keeps position snapshots deterministic for identical seeded states',()=>{
    const s=positioned()
    expect(offsideSnapshot(s.after,s.setup,s.passer.playerId)).toEqual(
      offsideSnapshot(s.after,s.setup,s.passer.playerId))
  })
  it('finds a legal retreat target even at goal and touchline edges',()=>{
    const s=withOffside()
    const called=applyOffsideLaw(s.played,s.contacted,s.setup)
    for(const spot of [{xM:100,yM:34},{xM:104,yM:66}]){
      const original=called.offsideRestart!
      const edge={...original,spot}
      const dead:MatchState={
        ...called,offsideRestart:edge,
        ball:{...called.ball,position:spot},
        ai:{...called.ai,enabledTeams:[true,true]},
        players:called.players.map(p=>p.clubId===edge.awardedTeamId
          ? p:{...p,position:{xM:103,yM:spot.yM},
            velocity:{xMps:0,yMps:0}}),
      }
      const staging=stageOffsideRestart(dead,s.setup)
      const opponents=staging.players.filter(p=>p.clubId!==edge.awardedTeamId)
      expect(opponents.every(p=>p.intention.kind==='moveToPoint' &&
        Math.hypot(p.intention.target.xM-spot.xM,
          p.intention.target.yM-spot.yM)>=9.15)).toBe(true)
      const moved:MatchState={...staging,players:staging.players.map(p=>
        p.intention.kind==='moveToPoint' && p.clubId!==edge.awardedTeamId
          ? {...p,position:{...p.intention.target}}:p)}
      expect(offsideOpponentsClear(moved,s.setup)).toBe(true)
    }
  })

})
