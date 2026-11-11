import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import type { FoundationMatchEngine } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

function advanceTo(engine: FoundationMatchEngine, tick: number): void {
  while (engine.getState().clock.tick < tick) {
    const remaining = tick - engine.getState().clock.tick
    engine.advance(Math.min(remaining, 10_000))
  }
}

const instructions = [
  { commandId: 'cmd-01', teamId: 'club_harbor', type: 'setPressingIntensity', intensity: 'high' },
  { commandId: 'cmd-02', teamId: 'club_vale', type: 'setPressingIntensity', intensity: 'low' },
  { commandId: 'cmd-03', teamId: 'club_harbor', type: 'setPressingIntensity', intensity: 'standard' },
] as const

describe('Phase 0E two-club foundation regression', () => {
  it('replays matching checkpoint bytes at multiple logical boundaries', () => {
    const left = createFoundationMatch(makeFictionalMatchSetup())
    const right = createFoundationMatch(makeFictionalMatchSetup())

    for (const engine of [left, right]) {
      expect(engine.submitCommand(instructions[0]).accepted).toBe(true)
      expect(engine.submitCommand(instructions[1]).accepted).toBe(true)
    }
    for (const tick of [0, 1, 100, 1000, 10000]) {
      advanceTo(left, tick)
      advanceTo(right, tick)
      if (tick === 100) {
        expect(left.submitCommand(instructions[2]).accepted).toBe(true)
        expect(right.submitCommand(instructions[2]).accepted).toBe(true)
      }
      expect(JSON.stringify(left.checkpoint())).toBe(JSON.stringify(right.checkpoint()))
    }
    expect(left.getState().appliedCommands.map((item) => item.commandId))
      .toEqual(['cmd-01', 'cmd-02', 'cmd-03'])
    expect(left.getState().teams.map((team) => team.pressingIntensity))
      .toEqual(['standard', 'low'])
  })

  it('restores both pending and applied commands and follows the same future steps', () => {
    const first = createFoundationMatch(makeFictionalMatchSetup())
    first.submitCommand(instructions[0])
    first.advance(500)
    first.submitCommand(instructions[1])
    const checkpoint = JSON.parse(JSON.stringify(first.checkpoint()))
    const resumed = restoreFoundationMatch(checkpoint)

    expect(resumed.getState().pendingCommands).toHaveLength(1)
    expect(resumed.getState().appliedCommands).toHaveLength(1)
    advanceTo(first, 10_800)
    advanceTo(resumed, 10_800)
    expect(JSON.stringify(resumed.checkpoint())).toBe(JSON.stringify(first.checkpoint()))
  })

  it('rejects corruption of the checkpoint version, fixture and immutable physics state', () => {
    const baseline = createFoundationMatch(makeFictionalMatchSetup()).checkpoint()
    const corruptions: ((copy: any) => void)[] = [
      (copy) => { copy.checkpointVersion = 50 },
      (copy) => { copy.setup.seed = -1 },
      (copy) => { copy.state.seed = 42 },
      (copy) => { copy.state.period = 'firstHalf' },
      (copy) => { copy.state.ball.position.xM += 1 },
      (copy) => { copy.state.players[0].energy -= 1 },
      (copy) => { copy.state.clock.tick = -1 },
      (copy) => { copy.state.randomStreams['ball/contact'].words[0] = 0 },
    ]
    for (const corrupt of corruptions) {
      const modified = JSON.parse(JSON.stringify(baseline))
      corrupt(modified)
      expect(() => restoreFoundationMatch(modified)).toThrow()
    }
  })

  it('uses one authoritative fixture for exactly two fictional teams', () => {
    const fixture = makeFictionalMatchSetup()
    const engine = createFoundationMatch(fixture)
    const state = engine.getState()
    expect(fixture.clubs.map((club) => club.name)).toEqual(['Harbor Athletic', 'Vale Rovers'])
    expect(state.players).toHaveLength(22)
    expect(state.teams.map((team) => team.clubId)).toEqual(fixture.clubs.map((club) => club.id))
    const ids = new Set(fixture.players.map((player) => player.id))
    expect(state.players.every((player) => ids.has(player.playerId))).toBe(true)
    expect(state.period).toBe('notStarted')
    expect(state.ball.controllerId).toBeNull()
  })

  it('keeps different seeds reproducible without inventing football outcomes', () => {
    const fixture = makeFictionalMatchSetup()
    const zero = createFoundationMatch({ ...fixture, seed: 0 })
    const anotherZero = createFoundationMatch({ ...fixture, seed: 0 })
    const maximum = createFoundationMatch({ ...fixture, seed: 0xffff_ffff })
    expect(zero.getState()).toEqual(anotherZero.getState())
    expect(zero.getState().players).toEqual(maximum.getState().players)
    expect(zero.getState().ball).toEqual(maximum.getState().ball)
    expect(zero.getState().randomStreams).not.toEqual(maximum.getState().randomStreams)
    zero.advance(100)
    maximum.advance(100)
    expect(zero.getState().teams.map((team) => team.score)).toEqual([0, 0])
    expect(maximum.getState().teams.map((team) => team.score)).toEqual([0, 0])
  })

  it('preserves supported non-default pitch dimensions in the shared setup', () => {
    const fixture = makeFictionalMatchSetup()
    const engine = createFoundationMatch({
      ...fixture,
      pitch: { ...fixture.pitch, lengthM: 110, widthM: 70 },
    })
    expect(engine.getSetup().pitch).toMatchObject({ lengthM: 110, widthM: 70 })
    expect(engine.getState().ball.position).toEqual({ xM: 55, yM: 35 })
    expect(engine.getState().players.every((player) =>
      player.position.xM >= 0 && player.position.xM <= 110 &&
      player.position.yM >= 0 && player.position.yM <= 70)).toBe(true)
  })
})
