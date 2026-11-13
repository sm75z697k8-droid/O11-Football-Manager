import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  createFoundationMatch, restoreFoundationMatch,
} from '../../src/game/match/engine'
import { openingKickoffPass } from '../../src/game/match/kickoff'
import {
  HALF_TICKS, secondHalfKickoffLegal, formatMatchTime,
} from '../../src/game/match/periods'

describe('S1.5 full referee 45+45-minute integration', () => {
  it('reaches an actual halftime whistle, legally changes ends, physically kicks off and finishes', () => {
    const fixture=makeFictionalMatchSetup()
    const setup={...fixture,kickoff:{teamId:fixture.clubs[0].id}}
    const engine=createFoundationMatch(setup)
    expect(engine.submitCommand(openingKickoffPass(engine.getState())).accepted)
      .toBe(true)
    engine.advance(2)
    expect(engine.getState().period).toBe('firstHalf')
    expect(engine.getState().clock.tick).toBe(2)
    for(let batch=0;batch<15 && engine.getState().period==='firstHalf';batch++){
      engine.advance(10000)
    }
    const atBreak=engine.getState()
    expect(atBreak.period).toBe('halfTime')
    expect(atBreak.clock.tick).toBe(
      2+HALF_TICKS+atBreak.periodTiming.firstHalfAddedTicks!)
    const paused=engine.checkpoint()
    engine.advance(1000)
    expect(engine.checkpoint()).toEqual(paused)
    const clone=restoreFoundationMatch(paused)
    expect(clone.checkpoint()).toEqual(paused)
    const second=engine.beginSecondHalf()
    const mirrored=clone.beginSecondHalf()
    expect(second).toEqual(mirrored)
    expect(second.teams[0].attackingDirection).toBe(-1)
    expect(second.teams[1].attackingDirection).toBe(1)
    expect(second.period).toBe('secondHalf')
    expect(second.periodKickoff?.teamId).toBe(fixture.clubs[1].id)
    expect(secondHalfKickoffLegal(second,setup)).toBe(true)
    const enable={
      commandId:'secondhalf-enabled',
      type:'setAutonomousTeam' as const,
      teamId:fixture.clubs[1].id,enabled:true,
    }
    expect(engine.submitCommand(enable).accepted).toBe(true)
    expect(clone.submitCommand(enable).accepted).toBe(true)
    for(let n=0;n<20 && engine.getState().periodKickoff;n++){
      engine.advance(1)
      clone.advance(1)
    }
    const kicked=engine.getState()
    expect(kicked.periodKickoff).toBeNull()
    expect(kicked.periodTiming.secondHalfStartTick).not.toBeNull()
    expect(kicked.contactEvents.filter(e=>e.commandId.startsWith(
      'ai-pass-secondhalf-') && e.outcome==='kicked')).toHaveLength(1)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint())
      .toEqual(engine.checkpoint())
    expect(clone.checkpoint()).toEqual(engine.checkpoint())
    expect(formatMatchTime(kicked)).toBe('45:00')
    const disable={
      commandId:'secondhalf-disabled',type:'setAutonomousTeam' as const,
      teamId:fixture.clubs[1].id,enabled:false,
    }
    expect(engine.submitCommand(disable).accepted).toBe(true)
    expect(clone.submitCommand(disable).accepted).toBe(true)
    for(let batch=0;batch<15 && engine.getState().period==='secondHalf';batch++){
      engine.advance(10000)
      clone.advance(10000)
    }
    const atEnd=engine.getState()
    expect(atEnd.period).toBe('fullTime')
    expect(atEnd.clock.tick).toBe(
      atEnd.periodTiming.secondHalfStartTick!+
      HALF_TICKS+atEnd.periodTiming.secondHalfAddedTicks!)
    const final=engine.checkpoint()
    engine.advance(120)
    expect(engine.checkpoint()).toEqual(final)
    expect(clone.checkpoint()).toEqual(final)
    expect(restoreFoundationMatch(final).checkpoint()).toEqual(final)
    console.info('[O11 S1.5 REAL FULL MATCH]', JSON.stringify({
      firstHalfStart:atBreak.periodTiming.firstHalfStartTick,
      halfTimeTick:atBreak.clock.tick,
      firstHalfAdded:atBreak.periodTiming.firstHalfAddedTicks,
      secondHalfStart:kicked.periodTiming.secondHalfStartTick,
      fullTimeTick:atEnd.clock.tick,
      secondHalfAdded:atEnd.periodTiming.secondHalfAddedTicks,
      score:atEnd.teams.map(t=>t.score),
    }))
  }, 60000)
})
