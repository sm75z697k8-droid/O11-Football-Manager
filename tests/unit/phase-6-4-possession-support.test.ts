import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import type { MatchState, PlayerMatchState } from '../../src/game/match/state'
import type { Point2 } from '../../src/game/model/pitch'
import type { MatchSetup } from '../../src/game/model/match'
import {
  chooseDynamicSupport, keepTeamFlank,
} from '../../src/game/ai/support-space'
import { supportTarget, separationM } from '../../src/game/ai/coordination'
import { evaluateOnBallChoice, AI_PASS_MIN_INTERVAL_TICKS } from '../../src/game/ai/possession'
import { planTeamDecisions } from '../../src/game/ai/decisions'

function baseline() {
  const setup = makeFictionalMatchSetup()
  const state = createFoundationMatch(setup).getState()
  return { setup, state }
}
function possession(
  setup: MatchSetup, state: MatchState, index: number, centre: Point2,
): MatchState {
  const owner = state.players[index]
  return {
    ...state,
    players: state.players.map(p => p.playerId === owner.playerId
      ? { ...p, position: centre, velocity: { xMps: 0, yMps: 0 } } : p),
    ball: {
      ...state.ball, position: centre, controllerId: owner.playerId,
      lastTouchPlayerId: owner.playerId, controlOffset: { xM: 0, yM: 0 },
    },
    ai: { ...state.ai, enabledTeams: [true, true] },
  }
}
function flankSign(player: PlayerMatchState, direction: number) {
  const right = ['RCM', 'RB', 'RW'].includes(player.formationSlot)
  return (right ? 1 : -1) * direction
}

describe('Phase 6.4 dynamic, spatially evaluated supporting runs', () => {
  it('produces bounded, deterministic destinations without changing match physics', () => {
    const { setup, state } = baseline()
    const initial = JSON.stringify(state)
    const reference = { xM: 57, yM: 32 }
    const first = chooseDynamicSupport(
      state, setup, setup.clubs[0].id, reference, new Set([state.players[9].playerId]))
    const second = chooseDynamicSupport(
      state, setup, setup.clubs[0].id, reference, new Set([state.players[9].playerId]))
    expect([...first]).toEqual([...second])
    expect(JSON.stringify(state)).toBe(initial)
    expect(first.size).toBe(9)
    for (const [id, option] of first) {
      const p = state.players.find(p => p.playerId === id)!
      expect(option.target.xM).toBeGreaterThanOrEqual(2.5)
      expect(option.target.xM).toBeLessThanOrEqual(setup.pitch.lengthM - 2.5)
      expect(option.target.yM).toBeGreaterThanOrEqual(2.5)
      expect(option.target.yM).toBeLessThanOrEqual(setup.pitch.widthM - 2.5)
      expect(Number.isFinite(option.utility)).toBe(true)
      if (['RCM','LCM','RW','LW','RB','LB'].includes(p.formationSlot)) {
        const direction = state.teams[0].attackingDirection
        const sign = flankSign(p, direction)
        expect((option.target.yM - setup.pitch.widthM / 2) * sign)
          .toBeGreaterThanOrEqual(
            ['RCM','LCM'].includes(p.formationSlot) ? 3 : 7)
      }
    }
  })

  it('maintains away-team flank orientation around the same carrier position', () => {
    const { setup, state } = baseline()
    const reference = { xM: 52, yM: 34 }
    const away = chooseDynamicSupport(
      state, setup, setup.clubs[1].id, reference, new Set())
    for (const slot of ['RCM','LCM','RW','LW','RB','LB']) {
      const p = state.players.find(p =>
        p.clubId === setup.clubs[1].id && p.formationSlot === slot)!
      const target = away.get(p.playerId)!.target
      const sign = flankSign(p, -1)
      expect((target.yM - setup.pitch.widthM / 2) * sign)
        .toBeGreaterThanOrEqual(['RCM','LCM'].includes(slot) ? 3 : 7)
    }
  })

  it('moves a supporting midfielder away from a newly blocked passing channel', () => {
    const { setup, state } = baseline()
    const teamId = setup.clubs[0].id
    const player = state.players.find(p =>
      p.clubId === teamId && p.formationSlot === 'RCM')!
    const carrier = { xM: 58, yM: 30 }
    const anchor = state.ai.formationPositions[player.playerId]
    const defaultTarget = supportTarget(player, anchor, carrier, 1, setup)
    const opponents = state.players.filter(p => p.clubId !== teamId)
    const blocker = opponents[0]
    const clearPlayers = state.players.map(p =>
      p.clubId !== teamId
        ? { ...p, position: { xM: 90, yM: 12 } }
        : p)
    const clear: MatchState = { ...state, players: clearPlayers }
    const blocked: MatchState = {
      ...clear,
      players: clear.players.map(p => p.playerId === blocker.playerId
        ? { ...p, position: { ...defaultTarget } } : p),
    }
    const selectedClear = chooseDynamicSupport(
      clear, setup, teamId, carrier, new Set([state.players[9].playerId]))
    const selectedBlocked = chooseDynamicSupport(
      blocked, setup, teamId, carrier, new Set([state.players[9].playerId]))
    const cleanChoice = selectedClear.get(player.playerId)!
    const threatened = selectedBlocked.get(player.playerId)!
    expect(separationM(threatened.target, defaultTarget)).toBeGreaterThan(.5)
    expect(threatened.defenderGapM).toBeGreaterThan(2)
    expect(separationM(cleanChoice.target, threatened.target)).toBeGreaterThan(.5)
  })

  it('uses separate supporting angles and does not abandon an intended pass receiver', () => {
    const { setup, state } = baseline()
    const owned = possession(setup, state, 9, { xM: 57, yM: 34 })
    const home = setup.clubs[0].id
    const snapshot = planTeamDecisions(owned, setup)
    const support = snapshot.filter(d => d.clubId === home && d.action === 'support')
    const mid = support.filter(d =>
      ['RCM','LCM'].includes(owned.players.find(p => p.playerId === d.playerId)!.formationSlot))
    expect(mid).toHaveLength(2)
    const right = mid.find(d =>
      owned.players.find(p => p.playerId === d.playerId)!.formationSlot === 'RCM')!
    const left = mid.find(d =>
      owned.players.find(p => p.playerId === d.playerId)!.formationSlot === 'LCM')!
    expect(right.target.yM).toBeGreaterThan(37)
    expect(left.target.yM).toBeLessThan(31)
    expect(separationM(right.target,left.target)).toBeGreaterThan(6)
  })

  it('never turns support selection into a fake touch or player teleport', () => {
    const { setup, state } = baseline()
    const original = JSON.stringify(state)
    const outcomes = chooseDynamicSupport(
      state, setup, setup.clubs[0].id, { xM: 55, yM: 33 }, new Set())
    expect(outcomes.size).toBe(10)
    expect(JSON.stringify(state)).toBe(original)
    expect(state.contactEvents).toHaveLength(0)
    expect(state.players.map(p => p.position)).toEqual(
      createFoundationMatch(setup).getState().players.map(p => p.position))
  })

  it('enforces pure role-flank constraints on wide players', () => {
    const { setup, state } = baseline()
    const winger = state.players.find(p => p.formationSlot === 'RW' &&
      p.clubId === setup.clubs[1].id)!
    const target = keepTeamFlank(winger, { xM: 60, yM: 66 }, -1, setup)
    expect(target.yM).toBeLessThanOrEqual(setup.pitch.widthM / 2 - 7)
    expect(target.xM).toBe(60)
  })
})

describe('Phase 6.4 possession decisions reward open outlets, not blind passes', () => {
  it('reduces the global cooldown while still preventing immediate repeat kicks', () => {
    expect(AI_PASS_MIN_INTERVAL_TICKS).toBe(24)
    expect(AI_PASS_MIN_INTERVAL_TICKS).toBeGreaterThan(12)
  })

  it('recognizes an open nearby lateral teammate as an available pass', () => {
    const { setup, state } = baseline()
    const owned = possession(setup, state, 9, { xM: 62, yM: 32 })
    const selected = owned.players[8]
    const updated: MatchState = {
      ...owned,
      players: owned.players.map(p => p.playerId === selected.playerId
        ? { ...p, position: { xM: 62, yM: 46 } } :
        p.clubId !== selected.clubId
          ? { ...p, position: { xM: 83, yM: 5 } } : p),
    }
    const best = evaluateOnBallChoice(updated, setup)
    expect(best?.kind).toBe('pass')
    if (best?.kind === 'pass') {
      expect(updated.players.some(p =>
        p.playerId === best.receiverId && p.clubId === selected.clubId))
        .toBe(true)
      expect(best.utility).toBeGreaterThan(0)
    }
  })

  it('does not force a pass when receivers are all out of physical range', () => {
    const { setup, state } = baseline()
    const controlled = possession(setup, state, 9, { xM: 45, yM: 34 })
    const noOutlet: MatchState = {
      ...controlled,
      players: controlled.players.map(p =>
        p.clubId === setup.clubs[0].id && p.playerId !== controlled.ball.controllerId
          ? { ...p, position: { xM: 4, yM: 4 } } : p),
    }
    expect(evaluateOnBallChoice(noOutlet, setup)?.kind).toBe('carry')
  })

  it('keeps deterministic replay after more frequent contextual passes', () => {
    const setup = makeFictionalMatchSetup()
    const engine = createFoundationMatch(setup)
    for (const club of setup.clubs) {
      expect(engine.submitCommand({
        commandId: 'ai-' + club.id,
        teamId: club.id, type: 'setAutonomousTeam', enabled: true,
      }).accepted).toBe(true)
    }
    engine.advance(220)
    const restored = restoreFoundationMatch(engine.checkpoint())
    engine.advance(80)
    restored.advance(40)
    restored.advance(40)
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
  })
})
