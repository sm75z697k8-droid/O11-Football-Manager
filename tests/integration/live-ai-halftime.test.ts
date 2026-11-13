import { describe, expect, it } from 'vitest'
import { makeExhibitionMatchSetup } from '../../src/data/fixtures/keeper-comparison'
import {
  createFoundationMatch, restoreFoundationMatch,
} from '../../src/game/match/engine'
import { openingKickoffPass } from '../../src/game/match/kickoff'
import {
  secondHalfKickoffLegal, HALF_TICKS,
} from '../../src/game/match/periods'

describe('S1.5 true two-AI-team 45-minute first half', () => {
  it('preserves real football, referee awards and replay through halftime and changed ends', () => {
    const template=makeExhibitionMatchSetup('balanced')
    const fixture={...template,seed:117,kickoff:{teamId:template.clubs[0].id}}
    const match=createFoundationMatch(fixture)
    for(const club of fixture.clubs){
      expect(match.submitCommand({
        commandId:'period-activate-'+club.id,
        type:'setAutonomousTeam',teamId:club.id,enabled:true,
      }).accepted).toBe(true)
    }
    expect(match.submitCommand(openingKickoffPass(match.getState())).accepted)
      .toBe(true)
    let chunks=0
    while(match.getState().period==='notStarted' ||
      match.getState().period==='firstHalf'){
      if(chunks++>18) throw new Error('AI match failed to reach lawful halftime')
      match.advance(10000)
    }
    const halftime=match.getState()
    expect(halftime.period).toBe('halfTime')
    expect(halftime.clock.tick).toBe(
      halftime.periodTiming.firstHalfStartTick!+
      HALF_TICKS+halftime.periodTiming.firstHalfAddedTicks!)
    expect(halftime.contactEvents.length).toBeGreaterThan(5)
    const counts={
      goals:halftime.goalEvents.length,
      throwIns:halftime.outOfPlayEvents.filter(e=>e.kind==='throwIn').length,
      goalKicks:halftime.outOfPlayEvents.filter(e=>e.kind==='goalKick').length,
      corners:halftime.outOfPlayEvents.filter(e=>e.kind==='corner').length,
      contact:halftime.contactEvents.length,
      commands:halftime.appliedCommands.length,
    }
    const checkpoint=match.checkpoint()
    expect(restoreFoundationMatch(checkpoint).checkpoint()).toEqual(checkpoint)
    const started=match.beginSecondHalf()
    expect(started.period).toBe('secondHalf')
    expect(secondHalfKickoffLegal(started,fixture)).toBe(true)
    for(let i=0;i<40 && match.getState().periodKickoff;i++){
      match.advance(1)
    }
    const returned=match.getState()
    expect(returned.periodKickoff).toBeNull()
    expect(returned.periodTiming.secondHalfStartTick).not.toBeNull()
    expect(returned.goalEvents).toEqual(halftime.goalEvents)
    expect(returned.teams.map(t=>t.score))
      .toEqual(halftime.teams.map(t=>t.score))
    const replay=restoreFoundationMatch(match.checkpoint())
    match.advance(30)
    replay.advance(30)
    expect(replay.checkpoint()).toEqual(match.checkpoint())
    let secondChunks=0
    while(match.getState().period==='secondHalf'){
      if(secondChunks++>20)
        throw new Error('Live AI football failed to reach final whistle')
      match.advance(10000)
    }
    const full=match.getState()
    expect(full.period).toBe('fullTime')
    expect(full.clock.tick).toBe(
      full.periodTiming.secondHalfStartTick!+HALF_TICKS+
      full.periodTiming.secondHalfAddedTicks!)
    expect(full.goalEvents.length).toBeGreaterThanOrEqual(halftime.goalEvents.length)
    expect(full.teams.reduce((sum,t)=>sum+t.score,0)).toBe(full.goalEvents.length)
    const completeCheckpoint=match.checkpoint()
    expect(restoreFoundationMatch(completeCheckpoint).checkpoint())
      .toEqual(completeCheckpoint)
    match.advance(8)
    expect(match.checkpoint()).toEqual(completeCheckpoint)
    console.info('[O11 S1.5 REAL AI HALFTIME]',JSON.stringify({
      seed:117,halftimeTick:halftime.clock.tick,
      firstHalfAdded:halftime.periodTiming.firstHalfAddedTicks,
      ...counts,
      secondHalfKickoffTick:returned.periodTiming.secondHalfStartTick,
      fullTimeTick:full.clock.tick,
      secondHalfAdded:full.periodTiming.secondHalfAddedTicks,
      finalScore:full.teams.map(t=>t.score),
      totalGoals:full.goalEvents.length,
      fullMatchCommands:full.appliedCommands.length,
    }))
  }, 60000)
})
