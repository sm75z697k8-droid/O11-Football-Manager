import { describe, expect, it } from 'vitest'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  sweptFootContact, resolveAutomaticBallContact, AUTO_CONTACT_COOLDOWN_TICKS,
} from '../../src/game/physics/automatic-contact'
import type { BallMatchState, MatchState, PlayerMatchState } from '../../src/game/match/state'

const fixture = makeFictionalMatchSetup
type Mutable<T> = { -readonly [P in keyof T]: T[P] }

function movingBall(state: MatchState, startX: number, endX: number, y = 34) {
  const beforeBall: BallMatchState = {
    ...state.ball, position: { xM: startX, yM: y },
    velocity: { xMps: 38, yMps: 0, zMps: 0 },
  }
  const afterBall: BallMatchState = {
    ...beforeBall, position: { xM: endX, yM: y },
  }
  return { beforeBall, afterBall }
}

describe('Phase 4 swept contact geometry and arbitration', () => {
  it('detects fast crossing missed by both endpoint-only reach tests', () => {
    const state = createFoundationMatch(fixture()).getState()
    const p = state.players[9]
    const before = { ...p, position: { xM: 76.65, yM: 34 } }
    const after = { ...before }
    const { beforeBall, afterBall } = movingBall(state, 74.8, 77.1)
    expect(Math.hypot(before.position.xM - beforeBall.position.xM, 0)).toBeGreaterThan(1.05)
    const swept = sweptFootContact(before, after, beforeBall, afterBall)
    expect(swept).not.toBeNull()
    expect(swept!.fraction).toBeGreaterThan(0)
    expect(swept!.fraction).toBeLessThan(1)
    expect(swept!.distanceM).toBeCloseTo(1.05, 8)
  })

  it('rejects a high ball for the entire interval and accepts one descending into reach', () => {
    const state = createFoundationMatch(fixture()).getState()
    const player = state.players[9]
    const p = { ...player, position: { xM: 76.65, yM: 34 } }
    const { beforeBall, afterBall } = movingBall(state, 76.4, 76.6)
    expect(sweptFootContact(p, p,
      { ...beforeBall, heightM: 2 },
      { ...afterBall, heightM: 2 },
    )).toBeNull()
    expect(sweptFootContact(p, p,
      { ...beforeBall, heightM: 1.4 },
      { ...afterBall, heightM: 0.11 },
    )).not.toBeNull()
  })

  it('detects a moving player entering a stationary ball path', () => {
    const state = createFoundationMatch(fixture()).getState()
    const player = state.players[9]
    const start = { ...player, position: { xM: 73, yM: 34 } }
    const end = { ...player, position: { xM: 75, yM: 34 } }
    const ball = { ...state.ball, position: { xM: 76, yM: 34 } }
    expect(sweptFootContact(start, end, ball, ball)).not.toBeNull()
  })

  it('does not grant contact to an unengaged player, even if the ball crosses their body', () => {
    const setup = fixture()
    const initial = createFoundationMatch(setup).getState()
    const player = initial.players[9]
    const { beforeBall, afterBall } = movingBall(initial,
      player.position.xM - 1.7, player.position.xM + 0.3, player.position.yM)
    const before: MatchState = { ...initial, ball: beforeBall }
    const after: MatchState = {
      ...before,
      clock: { ...before.clock, tick: 1 },
      ball: afterBall,
    }
    const result = resolveAutomaticBallContact(before, after, setup)
    expect(result).toBe(after)
    expect(result.automaticContactEvents).toHaveLength(0)
  })

  it('selects one physically earlier contender regardless of roster-array ordering', () => {
    const setup = fixture()
    const initial = createFoundationMatch(setup).getState()
    const a = initial.players[9]
    const b = initial.players[8]
    const moved = movingBall(initial, 74, 77)
    const beforeBall = { ...moved.beforeBall,
      velocity: { xMps: 8, yMps: 0, zMps: 0 } }
    const afterBall = { ...moved.afterBall,
      velocity: { xMps: 8, yMps: 0, zMps: 0 } }
    const players = initial.players.map(p => p.playerId === a.playerId
      ? { ...p, engagesBall: true, position: { xM: 76, yM: 34 } }
      : p.playerId === b.playerId
      ? { ...p, engagesBall: true, position: { xM: 75, yM: 34 } }
      : p)
    const before: MatchState = { ...initial, players, ball: beforeBall }
    const after: MatchState = {
      ...before, clock: { ...before.clock, tick: 1 }, ball: afterBall,
    }
    const first = resolveAutomaticBallContact(before, after, setup)
    const swapped = resolveAutomaticBallContact(
      { ...before, players: [...before.players].reverse() },
      { ...after, players: [...after.players].reverse() }, setup,
    )
    expect(first.automaticContactEvents).toHaveLength(1)
    expect(first.automaticContactEvents[0].playerId).toBe(b.playerId)
    expect(swapped.automaticContactEvents[0]).toEqual(first.automaticContactEvents[0])
    expect(first.ball.controllerId).toBe(b.playerId)
  })

  it('deflects fast incoming balls rather than awarding implausible instant possession', () => {
    const setup = fixture()
    const initial = createFoundationMatch(setup).getState()
    const p = initial.players[9]
    const { beforeBall, afterBall } = movingBall(initial,
      p.position.xM - 2, p.position.xM + 0.05, p.position.yM)
    const players: PlayerMatchState[] = initial.players.map(q => q.playerId === p.playerId
      ? { ...q, engagesBall: true } : q)
    const before: MatchState = { ...initial, players, ball: beforeBall }
    const after: MatchState = {
      ...before, clock: { ...before.clock, tick: 1 }, ball: afterBall,
    }
    const contacted = resolveAutomaticBallContact(before, after, setup)
    expect(contacted.automaticContactEvents[0].outcome).toBe('deflected')
    expect(contacted.ball.controllerId).toBeNull()
    expect(contacted.ball.lastTouchPlayerId).toBe(p.playerId)
    expect(contacted.ball.velocity.xMps).not.toBe(after.ball.velocity.xMps)
    expect(contacted.ballContactCooldownUntilTick).toBe(1 + AUTO_CONTACT_COOLDOWN_TICKS)
  })

  it('awards a challenge based on tackling attributes, not random team order', () => {
    const setup = structuredClone(fixture())
    const original = createFoundationMatch(setup).getState()
    const owner = original.players[9]
    const challenger = original.players[20]
    const ownerDef = setup.players.find(p => p.id === owner.playerId)!
    const contenderDef = setup.players.find(p => p.id === challenger.playerId)!
    ;(ownerDef.abilities.technical as Mutable<typeof ownerDef.abilities.technical>).dribbling = 5
    ;(ownerDef.abilities.physical as Mutable<typeof ownerDef.abilities.physical>).balance = 5
    ;(contenderDef.abilities.technical as Mutable<typeof contenderDef.abilities.technical>).tackling = 99
    ;(contenderDef.abilities.mental as Mutable<typeof contenderDef.abilities.mental>).anticipation = 99
    const loc = { xM: 80, yM: 34 }
    const players = original.players.map(p =>
      p.playerId === owner.playerId ? { ...p, position: loc } :
      p.playerId === challenger.playerId ?
        { ...p, engagesBall: true, position: { xM: 80.3, yM: 34 } } : p)
    const ball = {
      ...original.ball, position: { xM: 80.5, yM: 34 },
      controllerId: owner.playerId, lastTouchPlayerId: owner.playerId,
      controlOffset: { xM: 0.5, yM: 0 },
    }
    const before: MatchState = { ...original, players, ball }
    const after: MatchState = { ...before, clock: { ...before.clock, tick: 1 } }
    const outcome = resolveAutomaticBallContact(before, after, setup)
    expect(outcome.automaticContactEvents[0].kind).toBe('challenge')
    expect(outcome.automaticContactEvents[0].outcome).toBe('wonChallenge')
    expect(outcome.ball.controllerId).toBe(challenger.playerId)
  })

  it('keeps the owner in control when tackle strength is insufficient', () => {
    const setup = structuredClone(fixture())
    const original = createFoundationMatch(setup).getState()
    const owner = original.players[9]
    const attacker = original.players[20]
    const strong = setup.players.find(p => p.id === owner.playerId)!
    const weak = setup.players.find(p => p.id === attacker.playerId)!
    ;(strong.abilities.technical as Mutable<typeof strong.abilities.technical>).dribbling = 100
    ;(strong.abilities.physical as Mutable<typeof strong.abilities.physical>).balance = 100
    ;(weak.abilities.technical as Mutable<typeof weak.abilities.technical>).tackling = 0
    ;(weak.abilities.mental as Mutable<typeof weak.abilities.mental>).anticipation = 0
    const players = original.players.map(p => p.playerId === owner.playerId
      ? { ...p, position: { xM: 80, yM: 34 } }
      : p.playerId === attacker.playerId
      ? { ...p, engagesBall: true, position: { xM: 80.1, yM: 34 } }
      : p)
    const ball = {
      ...original.ball, position: { xM: 80.5, yM: 34 },
      controllerId: owner.playerId, lastTouchPlayerId: owner.playerId,
      controlOffset: { xM: 0.5, yM: 0 },
    }
    const before: MatchState = { ...original, players, ball }
    const after: MatchState = { ...before, clock: { ...before.clock, tick: 1 } }
    const result = resolveAutomaticBallContact(before, after, setup)
    expect(result.automaticContactEvents[0].outcome).toBe('heldOff')
    expect(result.ball.controllerId).toBe(owner.playerId)
    expect(result.ball).toEqual(ball)
  })
})
