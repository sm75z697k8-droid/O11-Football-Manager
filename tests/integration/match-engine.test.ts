import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MATCH_RANDOM_STREAM_IDS } from '../../src/game/match/state'

describe('Phase 0D 11v11 foundation state', () => {
  it('initializes one authoritative state for two fictional 4-3-3 teams', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const state = engine.getState()
    expect(state.players).toHaveLength(22)
    expect(new Set(state.players.map((player) => player.playerId)).size).toBe(22)
    expect(state.teams.map((team) => team.clubId)).toEqual(['club_harbor', 'club_vale'])
    expect(state.teams.map((team) => team.score)).toEqual([0, 0])
    expect(state.period).toBe('notStarted')
    expect(state.clock.tick).toBe(0)
    expect(state.ball.controllerId).toBeNull()
    expect(state.ball.position).toEqual({ xM: 52.5, yM: 34 })
    expect(Object.keys(state.randomStreams)).toEqual([...MATCH_RANDOM_STREAM_IDS])
    expect(state.players.every((player) => player.participation === 'onField')).toBe(true)
  })

  it('keeps player markers in the same metric pitch regardless of visuals', () => {
    const state = createFoundationMatch(makeFictionalMatchSetup()).getState()
    for (const player of state.players) {
      expect(player.position.xM).toBeGreaterThanOrEqual(0)
      expect(player.position.xM).toBeLessThanOrEqual(105)
      expect(player.position.yM).toBeGreaterThanOrEqual(0)
      expect(player.position.yM).toBeLessThanOrEqual(68)
    }
    const home = state.players.find((p) => p.clubId === 'club_harbor' && p.formationSlot === 'GK')
    const away = state.players.find((p) => p.clubId === 'club_vale' && p.formationSlot === 'GK')
    expect(home?.position.xM).toBeLessThan(52.5)
    expect(away?.position.xM).toBeGreaterThan(52.5)
  })

  it('does not generate goals, moving agents or fake football events', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const original = engine.getState()
    engine.advance(2000)
    const after = engine.getState()
    expect(after.clock.tick).toBe(2000)
    expect(after.players).toEqual(original.players)
    expect(after.ball).toEqual(original.ball)
    expect(after.teams.map((team) => team.score)).toEqual([0, 0])
    expect(after.period).toBe('notStarted')
  })

  it('does not allow UI or source-fixture mutations to alter internal state', () => {
    const setup = makeFictionalMatchSetup()
    const engine = createFoundationMatch(setup)
    const external = engine.getState()
    ;(external.players[0].position as { xM: number }).xM = 999
    ;(setup.players[0].profile as { fullName: string }).fullName = 'Mutated externally'
    expect(engine.getState().players[0].position.xM).not.toBe(999)
    expect(engine.getSetup().players[0].profile.fullName).not.toBe('Mutated externally')
  })

  it('rejects a malformed fixture before constructing the engine', () => {
    const bad = structuredClone(makeFictionalMatchSetup())
    ;(bad.players as unknown as { id: string }[])[1].id = bad.players[0].id
    expect(() => createFoundationMatch(bad)).toThrow()
  })

  it('serializes and restores without modifying any state', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.advance(16)
    engine.submitCommand({
      commandId: 'later', teamId: 'club_harbor',
      type: 'setPressingIntensity', intensity: 'high',
    })
    const restored = restoreFoundationMatch(JSON.parse(JSON.stringify(engine.checkpoint())))
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
    restored.advance()
    engine.advance()
    expect(restored.getState()).toEqual(engine.getState())
  })

  it('rejects tampered checkpoint IDs, RNG streams, pending commands and scores', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.submitCommand({
      commandId: 'pending', teamId: 'club_harbor', type: 'setPressingIntensity', intensity: 'high',
    })
    const base = engine.checkpoint()
    const mutate = (patch: (copy: any) => void) => {
      const copy = structuredClone(base)
      patch(copy)
      expect(() => restoreFoundationMatch(copy)).toThrow()
    }
    mutate((copy) => { copy.state.schemaVersion = 999 })
    mutate((copy) => { copy.state.players.pop() })
    mutate((copy) => { copy.state.teams[0].score = 99 })
    mutate((copy) => { delete copy.state.randomStreams['ball/contact'] })
    mutate((copy) => { copy.state.randomStreams['ball/contact'].masterSeed = 0 })
    mutate((copy) => { copy.state.pendingCommands[0].targetTick = 0 })
    mutate((copy) => { copy.state.nextCommandSequence = 99 })
  })

  it('rejects invalid advance quantities', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    for (const n of [-1, 0.5, NaN, Infinity, 10_001]) {
      expect(() => engine.advance(n)).toThrow()
    }
  })
})
