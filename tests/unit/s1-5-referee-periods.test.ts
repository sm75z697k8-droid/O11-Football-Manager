import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  createFoundationMatch, restoreFoundationMatch,
} from '../../src/game/match/engine'
import { openingKickoffPass } from '../../src/game/match/kickoff'
import {
  adjudicatePeriodTime, prepareSecondHalf, HALF_TICKS,
  TICKS_PER_MINUTE, formatMatchTime, formatMatchEventTime,
  periodKickoffPrefix, secondHalfKickoffLegal,
  secondHalfKickoffBallStationary,
} from '../../src/game/match/periods'
import type { MatchState } from '../../src/game/match/state'

function started() {
  const base = makeFictionalMatchSetup()
  const fixture = {...base, kickoff:{teamId:base.clubs[0].id}}
  const game = createFoundationMatch(fixture)
  const request = openingKickoffPass(game.getState())
  expect(game.submitCommand(request).accepted).toBe(true)
  game.advance(2)
  expect(game.getState().period).toBe('firstHalf')
  expect(game.getState().periodTiming.firstHalfStartTick).toBe(2)
  return game
}
function tickNearHalf(): MatchState {
  const state = started().getState()
  return {
    ...state,
    clock: {...state.clock, tick:HALF_TICKS+1},
    periodTiming: {
      ...state.periodTiming,
      firstHalfStartTick:1,
    },
  }
}

describe('S1.5 referee-controlled two 45-minute halves', () => {
  it('does not start a period before an actual opening kick moves', () => {
    const base = makeFictionalMatchSetup()
    const fixture = {...base,kickoff:{teamId:base.clubs[0].id}}
    const game = createFoundationMatch(fixture)
    game.advance(20)
    expect(game.getState().period).toBe('notStarted')
    expect(game.getState().periodTiming.firstHalfStartTick).toBeNull()
    expect(game.getState().periodTiming.halfTimeTick).toBeNull()
    expect(() => game.beginSecondHalf()).toThrow()
  })

  it('uses exactly 54,000 physics ticks per 45 minutes, without wall-time', () => {
    expect(HALF_TICKS).toBe(54000)
    expect(TICKS_PER_MINUTE).toBe(1200)
    const startedGame = started().getState()
    expect(formatMatchTime(startedGame)).toBe('00:00')
    expect(formatMatchTime({...startedGame, clock:{
      ...startedGame.clock, tick:startedGame.clock.tick+1200,
    }})).toBe('01:00')
    expect(formatMatchTime({...startedGame, clock:{
      ...startedGame.clock, tick:startedGame.clock.tick+HALF_TICKS,
    }})).toBe('45:00')
  })

  it('announces a minimum whole-minute allowance from actual dead-ball ticks', () => {
    const before = tickNearHalf()
    const dead: MatchState = {
      ...before,
      restart: {
        tick:2, kind:'throwIn',side:'top',
        awardedTeamId:before.teams[0].clubId,
        spot:{xM:40,yM:0},takerId:before.players[0].playerId,
        lastTouchPlayerId:before.players[11].playerId,
      },
    }
    const counted=adjudicatePeriodTime(dead)
    expect(counted.period).toBe('firstHalf')
    expect(counted.periodTiming.firstHalfLostTicks).toBe(1)
    expect(counted.periodTiming.firstHalfAddedTicks).toBe(TICKS_PER_MINUTE)
    const later=adjudicatePeriodTime({
      ...counted, clock:{...counted.clock,tick:HALF_TICKS+1201},
      restart:null,
    })
    expect(later.period).toBe('halfTime')
    expect(later.periodTiming.halfTimeTick).toBe(HALF_TICKS+1201)
    expect(later.periodTiming.firstHalfAddedTicks).toBe(TICKS_PER_MINUTE)
    expect(adjudicatePeriodTime(later)).toEqual(later)
  })

  it('will not advance the referee clock during a halftime or fulltime interval', () => {
    const match=started()
    const first=match.getState()
    const atTime=adjudicatePeriodTime({
      ...first,
      clock:{...first.clock,tick:2+HALF_TICKS},
    })
    expect(atTime.period).toBe('halfTime')
    expect(atTime.periodTiming.halfTimeTick).toBe(2+HALF_TICKS)
    const unchanged=adjudicatePeriodTime(atTime)
    expect(unchanged).toEqual(atTime)
    const final=adjudicatePeriodTime({
      ...atTime,
      period:'secondHalf',
      periodTiming:{
        ...atTime.periodTiming,
        secondHalfStartTick:2+HALF_TICKS+3,
      },
      clock:{...atTime.clock,tick:2+HALF_TICKS+3+HALF_TICKS},
    })
    expect(final.period).toBe('fullTime')
    expect(final.periodTiming.fullTimeTick).toBe(2+HALF_TICKS*2+3)
    expect(adjudicatePeriodTime(final)).toEqual(final)
  })

  it('swaps BOTH ends at halftime and positions an opposite-team legal kickoff', () => {
    const match=started()
    const initial=match.getState()
    const half:MatchState={
      ...initial, period:'halfTime',
      clock:{...initial.clock,tick:2+HALF_TICKS},
      periodTiming:{
        ...initial.periodTiming,
        halfTimeTick:2+HALF_TICKS,
        firstHalfAddedTicks:0,
      },
    }
    const ready=prepareSecondHalf(half,match.getSetup())
    expect(ready.period).toBe('secondHalf')
    expect(ready.periodTiming.secondHalfStartTick).toBeNull()
    expect(ready.periodKickoff?.teamId).toBe(ready.teams[1].clubId)
    expect(ready.teams[0].attackingDirection).toBe(-1)
    expect(ready.teams[1].attackingDirection).toBe(1)
    expect(ready.teams.map(t=>t.score)).toEqual([0,0])
    expect(ready.ball.position).toEqual({
      xM:match.getSetup().pitch.lengthM/2,
      yM:match.getSetup().pitch.widthM/2,
    })
    expect(secondHalfKickoffBallStationary(ready,match.getSetup())).toBe(true)
    expect(secondHalfKickoffLegal(ready,match.getSetup())).toBe(true)
    expect(ready.players.every(p=>
      p.velocity.xMps===0 && p.velocity.yMps===0)).toBe(true)
    expect(ready.ai.formationPositions[ready.players[0].playerId].xM)
      .toBeCloseTo(match.getSetup().pitch.lengthM -
        initial.ai.formationPositions[ready.players[0].playerId].xM)
    expect(ready.players.map(p=>p.energy)).toEqual(
      initial.players.map(p=>p.energy))
    expect(ready.goalEvents).toEqual(initial.goalEvents)
    expect(() => prepareSecondHalf(ready,match.getSetup())).toThrow()
  })

  it('rejects fictional second-half kick commands before referee halftime', () => {
    const match=started()
    const state=match.getState()
    const striker=state.players.find(p=>p.formationSlot==='ST' &&
      p.clubId===state.teams[1].clubId)!
    expect(match.submitCommand({
      commandId:periodKickoffPrefix(10)+'forged',
      type:'attemptKick',teamId:striker.clubId,
      playerId:striker.playerId,
      target:{xM:52,yM:32},power:.19,lift:0,
    }).accepted).toBe(false)
  })

  it('keeps old no-kickoff diagnostic fixtures independent of match periods', () => {
    const match=createFoundationMatch(makeFictionalMatchSetup())
    match.advance(240)
    expect(match.getState().period).toBe('notStarted')
    expect(formatMatchTime(match.getState())).toBe('00:00')
    const cp=match.checkpoint()
    expect(restoreFoundationMatch(cp).checkpoint()).toEqual(cp)
  })

  it('preserves historical event minutes across second-half changes and stoppage', () => {
    const startedGame=started().getState()
    const state:MatchState={
      ...startedGame, period:'secondHalf',
      clock:{...startedGame.clock,tick:2+2*HALF_TICKS+1200},
      periodTiming:{
        ...startedGame.periodTiming,
        halfTimeTick:2+HALF_TICKS,
        firstHalfAddedTicks:0,
        secondHalfStartTick:2+HALF_TICKS+3,
      },
    }
    expect(formatMatchEventTime(state,2+1200)).toBe('01:00')
    expect(formatMatchEventTime(state,2+HALF_TICKS+3+1200))
      .toBe('46:00')
    expect(formatMatchTime(state)).toContain('90+')
  })
})
