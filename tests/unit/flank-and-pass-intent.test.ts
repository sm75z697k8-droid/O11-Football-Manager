import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { supportTarget, separationM } from '../../src/game/ai/coordination'
import {
  activePassIntent, maintainPassReception, intendedReceiverTarget,
  PASS_INTENT_MAX_AGE_TICKS,
} from '../../src/game/ai/pass-coordination'
import type { MatchState, CoordinatedPassIntent } from '../../src/game/match/state'

const fixture = makeFictionalMatchSetup

function passFixture() {
  const setup = fixture()
  const state = createFoundationMatch(setup).getState()
  const passer = state.players[9]
  const receiver = state.players[8]
  const intent: CoordinatedPassIntent = {
    commandId: 'ai-pass-0-test',
    teamId: passer.clubId,
    passerId: passer.playerId,
    receiverId: receiver.playerId,
    target: { ...receiver.position },
    requestedTick: 0,
  }
  const planning: MatchState = {
    ...state,
    ai: {
      ...state.ai, enabledTeams: [true, false],
      passIntent: intent, lastPassTick: 0,
    },
  }
  return { setup, planning, intent, passer, receiver }
}

describe('Phase 6.3.1 team-relative flank discipline', () => {
  for (const index of [0, 1] as const) {
    it('keeps right and left flank roles on their OWN sides for team ' + index, () => {
      const setup = fixture()
      const state = createFoundationMatch(setup).getState()
      const teamId = setup.clubs[index].id
      const direction = index === 0 ? 1 : -1
      for (const ballY of [5, 34, 63]) {
        const reference = { xM: 52.5, yM: ballY }
        for (const [slot, right] of [
          ['RB', true], ['RW', true], ['RCM', true],
          ['LB', false], ['LW', false], ['LCM', false],
        ] as const) {
          const player = state.players.find(p =>
            p.clubId === teamId && p.formationSlot === slot)!
          const target = supportTarget(player, player.position,
            reference, direction, setup)
          const lateral = (target.yM - setup.pitch.widthM / 2) * direction
          expect(right ? lateral > 0 : lateral < 0).toBe(true)
          expect(Math.abs(lateral)).toBeGreaterThanOrEqual(slot.endsWith('CM') ? 3 : 7)
        }
      }
    })
  }

  it('mirrors both attacking directions in opening-kickoff central midfield positioning', () => {
    const basic = fixture()
    const home = createFoundationMatch({
      ...basic, kickoff: { teamId: basic.clubs[0].id },
    }).getState()
    const away = createFoundationMatch({
      ...basic, kickoff: { teamId: basic.clubs[1].id },
    }).getState()
    const locate = (state: typeof home, index: 0 | 1, slot: 'RCM' | 'LCM') =>
      state.players.find(p =>
        p.clubId === basic.clubs[index].id && p.formationSlot === slot)!
    expect(locate(home, 0, 'RCM').position.yM).toBeGreaterThan(34)
    expect(locate(home, 0, 'LCM').position.yM).toBeLessThan(34)
    expect(locate(away, 1, 'RCM').position.yM).toBeLessThan(34)
    expect(locate(away, 1, 'LCM').position.yM).toBeGreaterThan(34)
  })
})

describe('Phase 6.3.1 explicit intended receiver without manufactured contacts', () => {
  it('links a passer to a real teammate and engages that teammate immediately', () => {
    const { setup, planning, receiver } = passFixture()
    const revised = maintainPassReception(planning, setup)
    const player = revised.players.find(p => p.playerId === receiver.playerId)!
    expect(player.engagesBall).toBe(true)
    expect(player.intention.kind).toBe('moveToPoint')
    if (player.intention.kind === 'moveToPoint') {
      expect(player.intention.target).toEqual(planning.ai.passIntent?.target)
    }
    expect(revised.ai.passIntent?.receiverId).toBe(receiver.playerId)
    expect(revised.ball).toEqual(planning.ball)
    expect(revised.contactEvents).toEqual(planning.contactEvents)
  })

  it('follows the flight of a genuinely kicked pass instead of a stale point', () => {
    const { setup, planning, intent, receiver, passer } = passFixture()
    const tick = 2
    const moving: MatchState = {
      ...planning,
      clock: { ...planning.clock, tick },
      players: planning.players.map(p => p.playerId === receiver.playerId
        ? { ...p, position: { xM: 63.7, yM: 39 } } : p),
      ball: {
        ...planning.ball, position: { xM: 60, yM: 38 },
        velocity: { xMps: 8.8, yMps: 1.2, zMps: 0 },
        lastTouchPlayerId: passer.playerId,
      },
      contactEvents: [{
        commandId: intent.commandId, playerId: passer.playerId,
        tick: 1, kind: 'kick', outcome: 'kicked', drawUsed: 1,
      }],
    }
    const revised = maintainPassReception(moving, setup)
    const target = intendedReceiverTarget(moving, setup, intent)
    const receiving = revised.players.find(p => p.playerId === receiver.playerId)!
    expect(receiving.engagesBall).toBe(true)
    expect(receiving.intention.kind).toBe('moveToPoint')
    if (receiving.intention.kind === 'moveToPoint') {
      expect(receiving.intention.target).toEqual(target)
    }
    expect(separationM(target, intent.target)).toBeGreaterThan(.05)
    expect(revised.ball).toEqual(moving.ball)
  })

  it('discards a failed pass without forcing control or chasing forever', () => {
    const { setup, planning, intent, passer } = passFixture()
    const withFailure: MatchState = {
      ...planning,
      contactEvents: [{
        commandId: intent.commandId, playerId: passer.playerId,
        tick: 1, kind: 'kick', outcome: 'outOfReach', drawUsed: 0,
      }],
    }
    expect(activePassIntent(withFailure)).toBeNull()
    expect(maintainPassReception(withFailure, setup).ai.passIntent).toBeNull()
  })

  it('drops the pass instruction when an opponent touches or captures the ball', () => {
    const { setup, planning } = passFixture()
    const opponent = planning.players.find(p =>
      p.clubId !== planning.ai.passIntent?.teamId)!
    const intercepted: MatchState = {
      ...planning,
      clock: { ...planning.clock, tick: 2 },
      ball: { ...planning.ball, lastTouchPlayerId: opponent.playerId },
    }
    expect(maintainPassReception(intercepted, setup).ai.passIntent).toBeNull()
    const owned: MatchState = {
      ...intercepted,
      ball: { ...intercepted.ball, controllerId: opponent.playerId },
    }
    expect(maintainPassReception(owned, setup).ai.passIntent).toBeNull()
  })

  it('expires pass instructions so they cannot persist across unrelated play', () => {
    const { setup, planning } = passFixture()
    const aged: MatchState = {
      ...planning,
      clock: { ...planning.clock, tick: PASS_INTENT_MAX_AGE_TICKS + 1 },
    }
    expect(maintainPassReception(aged, setup).ai.passIntent).toBeNull()
  })
})
