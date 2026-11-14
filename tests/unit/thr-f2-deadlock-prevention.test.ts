import { describe, expect, it } from 'vitest'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { recordOutOfPlay,stageThrowIn,advanceThrowInStoppage,
  throwInReceiverTargets,throwInTakerTarget,
  throwInOpponentsClear } from '../../src/game/match/restarts'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { applyDueMatchCommands } from '../../src/game/match/commands'
import type { MatchState } from '../../src/game/match/state'

function realThrowIn(){
  const setup=makeFictionalMatchSetup()
  const original=createFoundationMatch(setup).getState()
  const prior:MatchState={...original,
    clock:{...original.clock,tick:100},
    ball:{...original.ball,position:{xM:38.2395,yM:67.96},
      controllerId:null,controlOffset:null,
      lastTouchPlayerId:'harbor_player_08',outsidePitch:false}}
  const out:MatchState={...prior,
    clock:{...prior.clock,tick:101},
    ball:{...prior.ball,position:{xM:38.2395,yM:68.21},
      outsidePitch:true}}
  const awarded=recordOutOfPlay(prior,out,setup)
  const restart=awarded.restart!
  expect(restart.kind).toBe('throwIn')
  expect(restart.awardedTeamId).toBe('club_vale')
  const team=awarded.teams.find(t=>t.clubId===restart.awardedTeamId)!
  const taker=awarded.players.find(p=>p.playerId===restart.takerId)!
  const spot=throwInTakerTarget(restart,setup)
  const receivers=awarded.players.filter(p=>
    p.clubId===team.clubId&&p.playerId!==taker.playerId&&
    p.formationSlot!=='GK').sort((a,b)=>{
      const point=(p:typeof a)=>awarded.ai.formationPositions[p.playerId]
      return Math.hypot(point(a).xM-restart.spot.xM,
        point(a).yM-restart.spot.yM)-
        Math.hypot(point(b).xM-restart.spot.xM,
          point(b).yM-restart.spot.yM)||
        a.playerId.localeCompare(b.playerId)
    }).slice(0,3)
  const targets=throwInReceiverTargets(restart,setup,team.attackingDirection)
  const prepared:MatchState={
    ...awarded,clock:{...awarded.clock,tick:140},
    ai:{...awarded.ai,enabledTeams:[true,true]},
    players:awarded.players.map(p=>{
      const i=receivers.findIndex(r=>r.playerId===p.playerId)
      return p.playerId===taker.playerId?
        {...p,position:{...spot},velocity:{xMps:0,yMps:0},
          orientationRad:-Math.PI/2}
        : i>=0?{...p,position:{...targets[i]},
            velocity:{xMps:0,yMps:0}}:p
    })
  }
  return {setup,prepared,restart,spot,receivers,targets,taker}
}

describe('THR-F2 restart deadlock prevention',()=>{
  it('throws to a physically accessible teammate without waiting for all three fixed receiving slots',()=>{
    const x=realThrowIn()
    const available=x.prepared.players.find(p=>
      p.playerId===x.receivers[0].playerId)!
    const nearer={xM:x.restart.spot.xM-3.3,
      yM:x.restart.spot.yM-7.6}
    const moved:MatchState={...x.prepared,
      players:x.prepared.players.map(p=>
        p.playerId===available.playerId?{...p,position:nearer}:
        x.receivers.slice(1).some(r=>r.playerId===p.playerId)?
          {...p,position:{xM:70,yM:30}}:p)}
    expect(throwInOpponentsClear(moved,x.restart)).toBe(true)
    expect(x.receivers.every((r,i)=>{
      const player=moved.players.find(p=>p.playerId===r.playerId)!
      return Math.hypot(player.position.xM-x.targets[i].xM,
        player.position.yM-x.targets[i].yM)>2.5
    })).toBe(true)
    const staged=stageThrowIn(moved,x.setup)
    const command=staged.pendingCommands.find(c=>c.type==='attemptThrowIn')
    expect(command).toBeDefined()
    expect(command?.playerId).toBe(x.taker.playerId)
    expect(command?.target).toEqual(nearer)
    const applied=applyDueMatchCommands({
      ...staged,clock:{...staged.clock,tick:141}})
    const resumed=advanceThrowInStoppage(
      applied,x.setup,resolveContactAttempts)
    expect(resumed.contactEvents.at(-1)?.outcome).toBe('thrownIn')
    expect(resumed.restart).toBeNull()
    expect(resumed.ball.controllerId).toBeNull()
  })

  for(const offset of [-.42,-.18,.18,.42]){
    for(const facing of [-Math.PI,0,Math.PI/2]){
      it(`settles a near-line Vale taker with y-offset ${offset} and orientation ${facing}`,()=>{
        const x=realThrowIn()
        let current:MatchState={...x.prepared,
          players:x.prepared.players.map(p=>p.playerId===x.taker.playerId
            ?{...p,position:{xM:x.spot.xM,
                yM:x.spot.yM+offset},orientationRad:facing}:p)}
        let released=false
        for(let tick=141;tick<=350;tick++){
          const applied=applyDueMatchCommands({...current,
            clock:{...current.clock,tick}})
          current=advanceThrowInStoppage(
            applied,x.setup,resolveContactAttempts)
          if(current.contactEvents.some(e=>e.outcome==='thrownIn')){
            released=true
            break
          }
        }
        expect(released).toBe(true)
        expect(current.restart).toBeNull()
        expect(current.ball.lastTouchPlayerId).toBe(x.taker.playerId)
      })
    }
  }

  it('never skips the 2m opponent clearance rule to escape a stuck restart',()=>{
    const x=realThrowIn()
    const blocker=x.prepared.players.find(p=>p.clubId!=='club_vale'&&
      p.formationSlot==='RCB')!
    const bad:MatchState={...x.prepared,
      players:x.prepared.players.map(p=>p.playerId===blocker.playerId
        ?{...p,position:{xM:x.restart.spot.xM,
          yM:x.restart.spot.yM-1.2}}:p)}
    expect(throwInOpponentsClear(bad,x.restart)).toBe(false)
    const first=stageThrowIn(bad,x.setup)
    expect(first.pendingCommands.filter(c=>c.type==='attemptThrowIn'))
      .toHaveLength(0)
    expect(first.ball.outsidePitch).toBe(true)
    // Players must move; simply aging the award cannot grant a kick.
  })
})
