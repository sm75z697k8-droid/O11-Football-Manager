import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { FOOT_REACH_M } from '../../src/game/physics/contact'

describe('Real seeded matches — close-control is authoritative, not cosmetic',()=>{
  it('moves held football foot offsets during real unopposed carries, never discards control without contact',()=>{
    let realCorrections=0
    let noContactLosses=0
    let checkedControlledTicks=0
    const exampleCorrections:{seed:number;tick:number;metres:number}[]=[]
    for(const seed of [42,90,117,205,7654321]) {
      const session=new MatchViewerSession(seed)
      for(let i=0;i<1600&&!session.state.ball.outsidePitch &&
        !session.state.goalEvents.length;i++){
        const prior=session.state
        session.advance(1)
        const after=session.state
        const oldId=prior.ball.controllerId
        if(!oldId)continue
        const owner=after.players.find(p=>p.playerId===oldId)
        if(!owner||owner.formationSlot==='GK')continue
        const actualRelease=after.contactEvents.some(e=>
          e.tick===after.clock.tick&&e.playerId===oldId&&
          (e.outcome==='kicked'||e.outcome==='thrown'))
        const actualContest=after.automaticContactEvents.some(e=>
          e.tick===after.clock.tick&&e.outcome==='wonChallenge')
        if(after.ball.controllerId===null &&
          !actualRelease&&!actualContest)noContactLosses++
        if(after.ball.controllerId!==oldId||!prior.ball.controlOffset||
          !after.ball.controlOffset)continue
        checkedControlledTicks++
        const offset=after.ball.controlOffset
        const offsetLength=Math.hypot(offset.xM,offset.yM)
        // Existing authentic first touches may begin as far as .82m
        // away; only the NEW corrective steps obey the tighter .75m
        // bound. All physical controlled offsets must fit foot reach.
        expect(offsetLength).toBeLessThanOrEqual(
          FOOT_REACH_M+.0000001)
        expect(after.ball.position.xM-owner.position.xM)
          .toBeCloseTo(offset.xM,8)
        expect(after.ball.position.yM-owner.position.yM)
          .toBeCloseTo(offset.yM,8)
        const change=Math.hypot(
          offset.xM-prior.ball.controlOffset.xM,
          offset.yM-prior.ball.controlOffset.yM)
        const nearestDefender=after.players.filter(p=>
          p.clubId!==owner.clubId).reduce((m,p)=>
          Math.min(m,Math.hypot(
            p.position.xM-owner.position.xM,
            p.position.yM-owner.position.yM)),100)
        if(change>.002&&nearestDefender>=7){
          realCorrections++
          if(exampleCorrections.length<5)exampleCorrections.push({
            seed,tick:after.clock.tick,metres:+change.toFixed(4)})
        }
      }
    }
    console.info('[O11 LIVE CLOSE CONTROL]',JSON.stringify({
      source:'genuine physical 50ms ticks, not a visual animation',
      seeds:5,controlledTicks:checkedControlledTicks,
      unopposedPhysicalCorrections:realCorrections,
      unexplainedControllerLosses:noContactLosses,
      examples:exampleCorrections,
    }))
    expect(checkedControlledTicks).toBeGreaterThan(100)
    expect(realCorrections).toBeGreaterThan(0)
    expect(noContactLosses).toBe(0)
  },30000)
})
