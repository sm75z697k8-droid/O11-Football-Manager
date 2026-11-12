import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import type { MatchState, PlayerMatchState } from '../../src/game/match/state'
import type { MatchSetup } from '../../src/game/model/match'
import type { PossessionChoice } from '../../src/game/ai/possession'
import {
  AI_PASS_MIN_INTERVAL_TICKS, evaluateOnBallPlan,
  evaluateOnBallChoice,
} from '../../src/game/ai/possession'
import {
  anticipatePlayer, reviewOnBallActions, MAX_ON_BALL_CANDIDATES,
  ON_BALL_HORIZON_SECONDS,
} from '../../src/game/ai/short-horizon'
import { choosePossessionRelease, planTeamDecisions } from '../../src/game/ai/decisions'
import { MatchViewerSession } from '../../src/game/viewer/session'

function synthetic(): { setup: MatchSetup; state: MatchState;
  carrier: PlayerMatchState; receiver: PlayerMatchState } {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const ballCarrier = initial.players.find(p =>
    p.clubId === setup.clubs[0].id && p.formationSlot === 'ST')!
  const runner = initial.players.find(p =>
    p.clubId === setup.clubs[0].id && p.formationSlot === 'RCM')!
  const players = initial.players.map(p => ({
    ...p,
    position: p.playerId === ballCarrier.playerId
      ? { xM: 54, yM: 34 }
      : p.playerId === runner.playerId
        ? { xM: 67, yM: 42 }
        : p.clubId === ballCarrier.clubId
          ? { xM: 7, yM: p.position.yM }
          : { xM: 90, yM: p.position.yM },
    velocity: { xMps: 0, yMps: 0 },
  }))
  const carrier = players.find(p => p.playerId === ballCarrier.playerId)!
  const receiver = players.find(p => p.playerId === runner.playerId)!
  return {
    setup, carrier, receiver,
    state: {
      ...initial, players,
      ball: {
        ...initial.ball, position: carrier.position,
        controllerId: carrier.playerId, lastTouchPlayerId: carrier.playerId,
        controlOffset: { xM: 0, yM: 0 },
      },
      ai: { ...initial.ai, enabledTeams: [true, true] },
    },
  }
}
const option = (receiverId: string): Extract<PossessionChoice, { kind: 'pass' }> => ({
  kind: 'pass', receiverId, target: { xM: 67, yM: 42 },
  power: .4, lift: 0, utility: 44,
})

describe('Phase 6.9A short-horizon tactical anticipation', () => {
  it('does not mutate state or make fake physical contacts', () => {
    const { setup, state } = synthetic()
    const before = JSON.stringify(state)
    const result = evaluateOnBallPlan(state, setup, true, true)
    const again = evaluateOnBallPlan(state, setup, true, true)
    expect(result).toEqual(again)
    expect(JSON.stringify(state)).toBe(before)
    expect(result.assessments.length).toBeGreaterThan(4)
    expect(result.assessments.length).toBeLessThanOrEqual(MAX_ON_BALL_CANDIDATES)
    expect(result.choice).not.toBeNull()
    expect(result.selectedReason.length).toBeGreaterThan(12)
    expect(state.contactEvents).toHaveLength(0)
  })

  it('recognizes an opponent approaching a pass lane before the ball arrives', () => {
    const { setup, state, receiver } = synthetic()
    const pass = option(receiver.playerId)
    const cleared = reviewOnBallActions(state, setup, [pass]).assessments[0]
    const defender = state.players.find(p =>
      p.clubId !== receiver.clubId && p.formationSlot === 'RCM')!
    const danger: MatchState = {
      ...state, players: state.players.map(p =>
        p.playerId === defender.playerId ? {
          ...p, position: { xM: 61, yM: 41 },
          velocity: { xMps: 0, yMps: -3.4 },
          intention: {
            kind: 'moveToPoint' as const, sinceTick: 0,
            target: { xM: 60, yM: 35 },
          },
        } : p),
    }
    const threatened = reviewOnBallActions(danger, setup, [pass]).assessments[0]
    expect(threatened.laneRisk).toBeGreaterThan(cleared.laneRisk)
    expect(threatened.utility).toBeLessThan(cleared.utility)
    expect(threatened.reasons.join(' ')).toMatch(/Defender|pressure/)
  })

  it('penalizes a receiver moving away from the aimed pass', () => {
    const { setup, state, receiver } = synthetic()
    const pass = option(receiver.playerId)
    const stationary = reviewOnBallActions(state, setup, [pass]).assessments[0]
    const moving: MatchState = {
      ...state,
      players: state.players.map(p =>
        p.playerId === receiver.playerId ? {
          ...p,
          velocity: { xMps: 5, yMps: 4 },
          intention: {
            kind: 'moveToPoint' as const, sinceTick: 0,
            target: { xM: 82, yM: 53 },
          },
        } : p),
    }
    const movingScore = reviewOnBallActions(moving, setup, [pass]).assessments[0]
    expect(movingScore.receivingRisk).toBeGreaterThan(stationary.receivingRisk)
    expect(movingScore.utility).toBeLessThan(stationary.utility)
    expect(movingScore.reasons.join(' ')).toContain('Receiver moving away')
  })

  it('anticipates meaningful physical velocity and target without moving a real player', () => {
    const { setup, carrier } = synthetic()
    const still = anticipatePlayer(carrier, setup, 1.2)
    const moving = anticipatePlayer({
      ...carrier,
      velocity: { xMps: 5, yMps: 0 },
      intention: {
        kind: 'moveToPoint', target: { xM: 72, yM: 34 },
        sinceTick: 0,
      },
    }, setup, 1.2)
    expect(still).toEqual(carrier.position)
    expect(moving.xM).toBeGreaterThan(still.xM + 1)
    expect(carrier.position.xM).toBe(54)
    expect(ON_BALL_HORIZON_SECONDS).toBeLessThanOrEqual(2)
  })

  it('keeps sensible carry continuity when the same run remains safe', () => {
    const { setup, state, carrier } = synthetic()
    const carrying: Extract<PossessionChoice, { kind: 'carry' }> = {
      kind: 'carry', target: { xM: 61, yM: 34 }, utility: 30,
    }
    const fresh = reviewOnBallActions(state, setup, [carrying]).assessments[0]
    const continuing: MatchState = {
      ...state,
      clock: { ...state.clock, tick: 20 },
      ai: {
        ...state.ai, decisionSnapshot: [{
          tick: 12, playerId: carrier.playerId,
          clubId: carrier.clubId, target: carrying.target,
          action: 'carry', engage: true,
        }],
      },
      players: state.players.map(p => p.playerId === carrier.playerId
        ? { ...p, intention: {
          kind: 'moveToPoint' as const, sinceTick: 12,
          target: carrying.target,
        } } : p),
    }
    const held = reviewOnBallActions(continuing, setup, [carrying]).assessments[0]
    expect(held.utility).toBeGreaterThan(fresh.utility)
    expect(held.reasons.join(' ')).toContain('Continues a sensible existing run')
  })

  it('bounds candidate count to avoid unbounded iPhone planning', () => {
    const { setup, state } = synthetic()
    const candidates: PossessionChoice[] = Array.from(
      { length: MAX_ON_BALL_CANDIDATES + 1 }, (_, i) => ({
        kind: 'carry' as const,
        target: { xM: 58 + i * .1, yM: 34 },
        utility: 10,
      }))
    expect(() => reviewOnBallActions(state, setup, candidates)).toThrow()
  })

  it('retains shot decisions from a clean box opportunity', () => {
    const { setup, state, carrier } = synthetic()
    const shooting: MatchState = {
      ...state,
      players: state.players.map(p =>
        p.playerId === carrier.playerId ? {
          ...p, position: { xM: 92, yM: 34 },
        } : p.clubId !== carrier.clubId && p.formationSlot !== 'GK'
          ? { ...p, position: { xM: 62, yM: 8 } } : p),
      ball: { ...state.ball, position: { xM: 92, yM: 34 } },
    }
    const plan = evaluateOnBallPlan(shooting, setup, true, true)
    expect(plan.choice?.kind).toBe('shoot')
    expect(plan.assessments.some(a => a.choice.kind === 'shoot')).toBe(true)
    expect(plan.selectedReason).toMatch(/Shot|Finishing|goalkeeper/)
  })

  it('uses the same deterministic decision for movement and physical release', () => {
    const { setup, state } = synthetic()
    const expected = evaluateOnBallChoice(state, setup, true, true)
    const release = choosePossessionRelease(state, setup)
    const plan = planTeamDecisions(state, setup)
    const carrier = state.players.find(p => p.playerId === state.ball.controllerId)!
    const instruction = plan.find(p => p.playerId === carrier.playerId)!
    if (expected?.kind === 'carry') {
      expect(release).toBeNull()
      expect(instruction.action).toBe('carry')
      expect(instruction.target).toEqual(expected.target)
    } else if (expected?.kind === 'pass' || expected?.kind === 'shoot') {
      expect(release?.kind).toBe(expected.kind === 'shoot' ? 'shoot' : 'pass')
      expect(release?.target).toEqual(expected.target)
      expect(instruction.engage).toBe(true)
    }
    expect(state.clock.tick - state.ai.lastPassTick)
      .toBeGreaterThanOrEqual(AI_PASS_MIN_INTERVAL_TICKS)
  })

  it('preserves exact real-match checkpoints across different tick chunks', () => {
    const match = new MatchViewerSession(821)
    const sameSeed = new MatchViewerSession(821)
    for (let i = 0; i < 48 && !match.state.ball.outsidePitch; i++) {
      match.advance(8)
    }
    const ticks = match.state.clock.tick
    let left = ticks
    while (left > 0) {
      const step = Math.min(1, left)
      sameSeed.advance(step)
      left -= step
    }
    expect(sameSeed.checkpoint()).toEqual(match.checkpoint())
    expect(restoreFoundationMatch(match.checkpoint()).checkpoint())
      .toEqual(match.checkpoint())
  })
})
