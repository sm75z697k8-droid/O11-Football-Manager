import { describe, expect, it } from 'vitest'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  AI_SAFE_EDGE_MARGIN_M, evaluateOnBallChoice, laneObstruction,
  segmentProximity,
} from '../../src/game/ai/possession'
import { choosePossessionRelease, planTeamDecisions } from '../../src/game/ai/decisions'
import type { MatchState, PlayerMatchState } from '../../src/game/match/state'
import type { MatchSetup } from '../../src/game/model/match'
import type { Point2 } from '../../src/game/model/pitch'

const setupFixture = makeFictionalMatchSetup

interface Context {
  readonly setup: MatchSetup
  readonly state: MatchState
  readonly owner: PlayerMatchState
  readonly receiver: PlayerMatchState
}

function context(
  ownerPosition: Point2 = { xM: 60, yM: 34 },
  receiverPosition: Point2 = { xM: 48, yM: 40 },
  closeDefender: Point2 | null = null,
): Context {
  const setup = setupFixture()
  const base = createFoundationMatch(setup).getState()
  const carrier = base.players[9]
  const receiver = base.players[8]
  const obstacle = base.players[19]
  // Give the planner a controlled scene with only one physically useful
  // outlet. This is a synthetic tactical unit fixture, not actual gameplay.
  const players = base.players.map(p => {
    let position: Point2 = p.clubId === carrier.clubId
      ? { xM: 8, yM: 7 } : { xM: 89, yM: 7 }
    if (p.playerId === carrier.playerId) position = ownerPosition
    if (p.playerId === receiver.playerId) position = receiverPosition
    if (p.playerId === obstacle.playerId && closeDefender) position = closeDefender
    return { ...p, position, velocity: { xMps: 0, yMps: 0 } }
  })
  const state: MatchState = {
    ...base,
    players,
    ball: {
      ...base.ball,
      position: { ...ownerPosition },
      controllerId: carrier.playerId,
      controlOffset: { xM: 0, yM: 0 },
      lastTouchPlayerId: carrier.playerId,
    },
    ai: { ...base.ai, enabledTeams: [true, false] },
  }
  return {
    setup,
    state,
    owner: players.find(p => p.playerId === carrier.playerId)!,
    receiver: players.find(p => p.playerId === receiver.playerId)!,
  }
}

describe('Context-aware possession without predetermined match outcomes', () => {
  it('does not create a decision when nobody controls the real ball', () => {
    const { state, setup } = context()
    const free: MatchState = {
      ...state, ball: {
        ...state.ball, controllerId: null, controlOffset: null,
      },
    }
    expect(evaluateOnBallChoice(free, setup)).toBeNull()
    expect(choosePossessionRelease(free, setup)).toBeNull()
  })

  it('carries into available space when no sensible receivers are within range', () => {
    const { state, setup, owner } = context(
      { xM: 45, yM: 34 }, { xM: 3, yM: 3 },
    )
    const choice = evaluateOnBallChoice(state, setup)
    expect(choice?.kind).toBe('carry')
    if (choice?.kind !== 'carry') return
    expect(choice.target.xM).toBeGreaterThan(owner.position.xM)
    expect(choice.target.xM).toBeLessThan(setup.pitch.lengthM)
    expect(choice.target.yM).toBeGreaterThanOrEqual(AI_SAFE_EDGE_MARGIN_M)
    expect(choosePossessionRelease(state, setup)).toBeNull()
  })

  it('uses a backward teammate as a valid pass under actual defensive pressure', () => {
    const { setup, state, owner, receiver } = context(
      { xM: 60, yM: 34 },
      { xM: 47, yM: 39 },
      { xM: 62, yM: 34 },
    )
    const choice = evaluateOnBallChoice(state, setup)
    expect(choice?.kind).toBe('pass')
    if (choice?.kind !== 'pass') return
    expect(choice.receiverId).toBe(receiver.playerId)
    expect(choice.target.xM).toBeLessThan(owner.position.xM)
    expect(choice.power).toBeGreaterThan(0)
    expect(choosePossessionRelease(state, setup)?.target).toEqual(choice.target)
  })

  it('tries a real shot or safer recycling rather than dribbling across the goal line', () => {
    const { setup, state, receiver } = context(
      { xM: 102, yM: 34 }, { xM: 89, yM: 37 },
    )
    const decision = evaluateOnBallChoice(state, setup)
    expect(['pass','shoot']).toContain(decision?.kind)
    if (decision?.kind === 'pass') {
      expect(decision.receiverId).toBe(receiver.playerId)
      expect(decision.target.xM).toBeLessThan(102)
    } else if (decision?.kind === 'shoot') {
      expect(decision.target.xM).toBe(setup.pitch.lengthM)
      expect(decision.power).toBeGreaterThan(.5)
    }
  })

  it('never generates a carry point on a pitch boundary, even with no pass', () => {
    const { setup, state } = context(
      { xM: 104.8, yM: 66.9 }, { xM: 3, yM: 3 },
    )
    const decision = evaluateOnBallChoice(state, setup, false)
    expect(decision?.kind).toBe('carry')
    if (decision?.kind !== 'carry') return
    expect(decision.target.xM).toBeLessThanOrEqual(
      setup.pitch.lengthM - AI_SAFE_EDGE_MARGIN_M,
    )
    expect(decision.target.xM).toBeGreaterThanOrEqual(AI_SAFE_EDGE_MARGIN_M)
    expect(decision.target.yM).toBeLessThanOrEqual(
      setup.pitch.widthM - AI_SAFE_EDGE_MARGIN_M,
    )
  })

  it('considers marked passing lanes rather than just receiver distance', () => {
    const ctx = context(
      { xM: 60, yM: 34 }, { xM: 76, yM: 34 }, { xM: 69, yM: 34 },
    )
    const blocked = laneObstruction(
      ctx.owner.position, ctx.receiver.position,
      ctx.state.players.filter(p => p.clubId !== ctx.owner.clubId),
    )
    expect(blocked).toBeGreaterThan(3)
    const open = ctx.state.players.filter(p => p.clubId !== ctx.owner.clubId)
      .map(p => p.playerId === ctx.state.players[19].playerId
        ? { ...p, position: { xM: 85, yM: 58 } } : p)
    const cleared = laneObstruction(ctx.owner.position, ctx.receiver.position, open)
    expect(cleared).toBeLessThan(blocked)
  })

  it('rejects a pass through a defender when a safer lateral outlet exists', () => {
    const base = context({ xM: 60, yM: 34 },
      { xM: 77, yM: 34 }, { xM: 69, yM: 34 })
    const second = base.state.players[7]
    const players = base.state.players.map(p =>
      p.playerId === second.playerId
        ? { ...p, position: { xM: 60, yM: 48 } }
        : p)
    const state = { ...base.state, players }
    const decision = evaluateOnBallChoice(state, base.setup)
    expect(decision?.kind).toBe('pass')
    if (decision?.kind !== 'pass') return
    expect(decision.receiverId).toBe(second.playerId)
    expect(decision.target.yM).toBeGreaterThan(40)
  })

  it('uses a real geometric fraction to locate danger along a pass', () => {
    expect(segmentProximity(
      { xM: 5, yM: 1 }, { xM: 0, yM: 0 }, { xM: 10, yM: 0 },
    )).toEqual({ distanceM: 1, fraction: .5 })
    expect(segmentProximity(
      { xM: 11, yM: 0 }, { xM: 0, yM: 0 }, { xM: 10, yM: 0 },
    )).toEqual({ distanceM: 1, fraction: 1 })
  })

  it('is deterministic, does not mutate input, and handles either attacking direction', () => {
    const { setup, state } = context()
    const checkpoint = JSON.stringify(state)
    expect(evaluateOnBallChoice(state, setup)).toEqual(evaluateOnBallChoice(state, setup))
    expect(JSON.stringify(state)).toBe(checkpoint)
    const awayOwner = state.players[20]
    const away: MatchState = {
      ...state,
      players: state.players.map(p => p.playerId === awayOwner.playerId
        ? { ...p, position: { xM: 62, yM: 34 } } : p),
      ball: {
        ...state.ball,
        controllerId: awayOwner.playerId,
        lastTouchPlayerId: awayOwner.playerId,
        position: { xM: 62, yM: 34 },
      },
    }
    const awayChoice = evaluateOnBallChoice(away, setup, false)
    expect(awayChoice?.kind).toBe('carry')
    if (awayChoice?.kind === 'carry') {
      expect(awayChoice.target.xM).toBeLessThanOrEqual(62)
    }
  })

  it('respects AI pass cooldown and does not queue an instant second release', () => {
    const { setup, state } = context(
      { xM: 60, yM: 34 }, { xM: 48, yM: 40 }, { xM: 61, yM: 34 },
    )
    const chosen = choosePossessionRelease(state, setup)
    expect(chosen).not.toBeNull()
    const cooling: MatchState = {
      ...state,
      ai: { ...state.ai, lastPassTick: state.clock.tick },
    }
    expect(choosePossessionRelease(cooling, setup)).toBeNull()
    const decision = planTeamDecisions(cooling, setup)
    expect(decision).toHaveLength(11)
    expect(decision.find(d => d.playerId === state.ball.controllerId)?.action)
      .toBe('carry')
  })
})
