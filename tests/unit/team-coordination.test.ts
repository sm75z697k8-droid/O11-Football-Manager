import { describe, expect, it } from 'vitest'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { advanceBallPhysics } from '../../src/game/physics/ball'
import {
  predictBallAt, estimateInterception, rankBallChasers, supportTarget,
  coverTarget, markTarget, separationM,
} from '../../src/game/ai/coordination'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import type { MatchState } from '../../src/game/match/state'

const setup = makeFictionalMatchSetup

describe('Phase 6.3 real spatial ball anticipation', () => {
  it('predicts actual ground-ball travel from existing friction physics', () => {
    const fixture = setup()
    const state = createFoundationMatch(fixture).getState()
    const moving = {
      ...state.ball,
      velocity: { xMps: -7, yMps: 3.3, zMps: 0 },
    }
    let actual = moving
    for (let i = 0; i < 20; i += 1) {
      actual = advanceBallPhysics(actual, fixture.pitch)
    }
    const predicted = predictBallAt(moving, 1)
    expect(predicted.position.xM).toBeCloseTo(actual.position.xM, 7)
    expect(predicted.position.yM).toBeCloseTo(actual.position.yM, 7)
    expect(predicted.heightM).toBeCloseTo(actual.heightM, 7)
  })

  it('targets a reachable future ball position instead of its current centre', () => {
    const fixture = setup()
    const state = createFoundationMatch(fixture).getState()
    const player = state.players[6]
    const definition = fixture.players.find(p => p.id === player.playerId)!
    const receiving = {
      ...player,
      position: { xM: 46.7, yM: 37.4 },
      velocity: { xMps: 0, yMps: 0 },
    }
    const ball = { ...state.ball,
      position: { xM: 52.5, yM: 34 },
      velocity: { xMps: -6.9, yMps: 3.6, zMps: 0 },
    }
    const arrival = estimateInterception(receiving, definition, ball, fixture.pitch)
    expect(arrival).not.toBeNull()
    expect(arrival!.target.xM).toBeLessThan(ball.position.xM - 1)
    expect(arrival!.etaSeconds).toBeGreaterThan(.2)
    expect(arrival!.etaSeconds).toBeLessThan(2)
    expect(arrival!.target.yM).toBeGreaterThan(34)
  })

  it('ranks interception using reachable travel time, not raw current distance', () => {
    const fixture = setup()
    const state = createFoundationMatch(fixture).getState()
    const receiver = state.players[6]
    const winger = state.players[8]
    const players = [
      { ...receiver, position: { xM: 46, yM: 37 } },
      { ...winger, position: { xM: 53, yM: 20 } },
    ]
    const defs = new Map(fixture.players.map(p => [p.id, p]))
    const ball = {
      ...state.ball,
      velocity: { xMps: -7, yMps: 3, zMps: 0 },
    }
    expect(rankBallChasers(players, defs, ball, fixture.pitch)[0].playerId)
      .toBe(receiver.playerId)
  })

  it('creates separated midfield support lanes rather than identical ball chases', () => {
    const fixture = setup()
    const state = createFoundationMatch(fixture).getState()
    const rcm = state.players.find(p => p.formationSlot === 'RCM' &&
      p.clubId === fixture.clubs[0].id)!
    const lcm = state.players.find(p => p.formationSlot === 'LCM' &&
      p.clubId === fixture.clubs[0].id)!
    const ball = { xM: 54, yM: 34 }
    const right = supportTarget(rcm, rcm.position, ball, 1, fixture)
    const left = supportTarget(lcm, lcm.position, ball, 1, fixture)
    expect(right.yM).toBeGreaterThan(ball.yM + 3)
    expect(left.yM).toBeLessThan(ball.yM - 3)
    expect(separationM(right, left)).toBeGreaterThan(9)
    for (const point of [right, left]) {
      expect(point.xM).toBeGreaterThan(0)
      expect(point.xM).toBeLessThan(fixture.pitch.lengthM)
      expect(point.yM).toBeGreaterThan(0)
      expect(point.yM).toBeLessThan(fixture.pitch.widthM)
    }
  })

  it('keeps cover behind the presser and marker movement bounded to shape', () => {
    const fixture = setup()
    const state = createFoundationMatch(fixture).getState()
    const defender = state.players[17]
    const presser = state.players[16]
    const target = coverTarget(defender, presser, { xM: 48, yM: 33 }, -1, fixture.pitch)
    expect(target.xM).toBeGreaterThan(48)
    const marked = markTarget({ xM: 74, yM: 30 }, state.players[9], -1, fixture.pitch)
    expect(separationM(marked, { xM: 74, yM: 30 })).toBeLessThanOrEqual(13.01)
  })

  it('does not trigger pursuit or pretend there is possession outside the pitch', () => {
    const fixture = setup()
    const original = createFoundationMatch(fixture).getState()
    const state: MatchState = { ...original,
      ai: { ...original.ai, enabledTeams: [true, true] },
      ball: {
        ...original.ball, position: { xM: 110, yM: 34 },
        outsidePitch: true, velocity: { xMps: 4, yMps: 0, zMps: 0 },
      },
    }
    const decisions = planTeamDecisions(state, fixture)
    expect(decisions).toHaveLength(22)
    expect(decisions.every(d => !d.engage)).toBe(true)
  })
})
