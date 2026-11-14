import { describe, it, expect } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { assessThrowInOptions, throwInReceiverTargets, throwInOpponentsClear,
  throwInFacingAngle, throwInTakerTarget } from '../../src/game/match/restarts'
import { wrapRadians } from '../../src/game/physics/locomotion'

describe('BUG THR-F2 EFAD5103 35:05 live-stall investigation',()=>{
  it('reproduces long Vale throw-in stage in unmodified production 2-team viewer',()=>{
    const s=new MatchViewerSession(0xEFAD5103,'keeper-comparison')
    const stamps=new Set([38384,38984,42108])
    while(s.state.clock.tick<42108){
      s.advance(Math.min(8,42108-s.state.clock.tick))
      const st=s.state
      if(!stamps.has(st.clock.tick))continue
      const e=st.restart
      if(!e){
        console.log('[THR-F2 snapshot]',JSON.stringify({tick:st.clock.tick,restart:null,
          exits:st.outOfPlayEvents.slice(-4),latestContact:st.contactEvents.slice(-2)}))
        continue
      }
      const team=st.teams.find(t=>t.clubId===e.awardedTeamId)!
      const taker=st.players.find(p=>p.playerId===e.takerId)!
      const target=throwInTakerTarget(e,s.setup)
      const available=st.players.filter(p=>p.clubId===e.awardedTeamId&&p.playerId!==e.takerId&&
        p.formationSlot!=='GK').sort((a,b)=>{
          const point=(p:typeof a)=>st.ai.formationPositions[p.playerId]??p.position
          return Math.hypot(point(a).xM-e.spot.xM,point(a).yM-e.spot.yM)-
            Math.hypot(point(b).xM-e.spot.xM,point(b).yM-e.spot.yM)||
            a.playerId.localeCompare(b.playerId)
        }).slice(0,3)
      const targets=throwInReceiverTargets(e,s.setup,team.attackingDirection)
      const blockers=st.players.filter(p=>p.clubId!==e.awardedTeamId &&
        Math.hypot(p.position.xM-e.spot.xM,p.position.yM-e.spot.yM)<2)
      const selections=assessThrowInOptions(st,s.setup,e,available,targets)
      console.log('[THR-F2 snapshot]',JSON.stringify({
        tick:st.clock.tick,elapsed:st.clock.tick-e.tick,team:team.clubId,
        taker:e.takerId,
        takerPosition:taker.position,takerVelocity:taker.velocity,
        takerOrientation:taker.orientationRad,takerFacingError:wrapRadians(taker.orientationRad-throwInFacingAngle(e)),
        takerTarget:target,takerIntention:taker.intention,
        takerGap:Math.hypot(taker.position.xM-target.xM,taker.position.yM-target.yM),
        takerSpeed:Math.hypot(taker.velocity.xMps,taker.velocity.yMps),
        receiverPositions:available.map((p,i)=>({
          id:p.playerId,slot:p.formationSlot,position:p.position,
          target:targets[i],gap:Math.hypot(p.position.xM-targets[i].xM,p.position.yM-targets[i].yM),
          speed:Math.hypot(p.velocity.xMps,p.velocity.yMps),intent:p.intention,
        })),
        blockerDetails:blockers.map(p=>({id:p.playerId,position:p.position,
          velocity:p.velocity,intention:p.intention})),
        opponentsClear:throwInOpponentsClear(st,e),
        selections:selections.slice(0,3),pending:st.pendingCommands.slice(-3),
        lastCommand:st.appliedCommands.at(-1),
        lastContact:st.contactEvents.at(-1),
      }))
    }
    expect(s.state.restart).toBeNull()
  },240_000)
})
