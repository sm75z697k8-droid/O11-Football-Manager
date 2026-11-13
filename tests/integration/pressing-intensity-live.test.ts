import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { openingKickoffPass } from '../../src/game/match/kickoff'
import type { PressingIntensity } from '../../src/game/match/state'

/**
 * Real, authoritative AI and physics for both teams, actual tactical
 * setPressingIntensity commands, and genuine opening kick-off contact.
 * This is not match-result scripting or measured professional tracking.
 */
describe('Phase 6.9O — live three-intensity pressing and physical contacts',()=>{
  it('bounds simultaneous pressers while preserving actual matches and seeded action history',()=>{
    const results:{
      seed:number;intensity:PressingIntensity;
      controlledFrames:number;defendingPressFrames:number;
      noPressFrames:number;doublePressFrames:number;
      actualChallenges:number;actualShots:number;goals:number;
    }[]=[]
    for(const intensity of ['low','standard','high'] as const){
      for(const seed of [42,90]){
        const fixture=makeFictionalMatchSetup()
        const setup={...fixture,seed,kickoff:{teamId:fixture.clubs[0].id}}
        const engine=createFoundationMatch(setup)
        for(const club of fixture.clubs) {
          expect(engine.submitCommand({
            commandId:'6.9O-enable-'+club.id,
            teamId:club.id,type:'setAutonomousTeam',enabled:true,
          }).accepted).toBe(true)
          expect(engine.submitCommand({
            commandId:'6.9O-press-'+club.id,
            teamId:club.id,type:'setPressingIntensity',intensity,
          }).accepted).toBe(true)
        }
        expect(engine.submitCommand(openingKickoffPass(engine.getState()))
          .accepted).toBe(true)
        let controlledFrames=0
        let defendingPressFrames=0
        let noPressFrames=0
        let doublePressFrames=0
        for(let i=0;i<130 &&
            !engine.getState().ball.outsidePitch &&
            !engine.getState().goalEvents.length;i++){
          const s=engine.advance(8)
          const owner=s.players.find(p=>p.playerId===s.ball.controllerId)
          if(!owner)continue
          controlledFrames++
          const defending=s.ai.decisionSnapshot.filter(d=>
            d.clubId!==owner.clubId&&d.action==='press')
          const allowed=intensity==='high'?2:1
          expect(defending.length).toBeLessThanOrEqual(allowed)
          expect(new Set(defending.map(p=>p.playerId)).size)
            .toBe(defending.length)
          if(defending.length===0)noPressFrames++
          else defendingPressFrames++
          if(defending.length===2)doublePressFrames++
        }
        const final=engine.getState()
        expect(final.teams.every(t=>t.pressingIntensity===intensity))
          .toBe(true)
        expect(final.contactEvents.some(e=>e.outcome==='kicked'))
          .toBe(true)
        expect(final.teams.reduce((sum,t)=>sum+t.score,0))
          .toBe(final.goalEvents.length)
        const actualShots=final.contactEvents.filter(e=>
          e.outcome==='kicked'&&e.commandId.startsWith('ai-shot-')).length
        results.push({seed,intensity,controlledFrames,defendingPressFrames,
          noPressFrames,doublePressFrames,
          actualChallenges:final.automaticContactEvents.filter(e=>
            e.kind==='challenge').length,
          actualShots,goals:final.goalEvents.length})
      }
    }
    console.info('[O11 PHYSICAL PRESSING INTENSITY AUDIT] '+JSON.stringify({
      source:'two short genuine fictional seeded matches per tactical intensity; not Safari',
      results,
    }))
    expect(results).toHaveLength(6)
    expect(results.every(r=>r.controlledFrames>0)).toBe(true)
    expect(results.filter(r=>r.intensity==='low')
      .every(r=>r.doublePressFrames===0)).toBe(true)
    expect(results.filter(r=>r.intensity==='standard')
      .every(r=>r.doublePressFrames===0)).toBe(true)
  },60000)
})
