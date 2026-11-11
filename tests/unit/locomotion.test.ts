import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { deriveMotionLimits, PLAYER_STEP_SECONDS, wrapRadians } from '../../src/game/physics/locomotion'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

const setup = makeFictionalMatchSetup
const instruction = (id: string, playerId: string, xM: number, yM: number, teamId = 'club_harbor') => ({
  commandId: id, teamId, type: 'setMovementTarget' as const,
  playerId, target: { xM, yM },
})

describe('Phase 1 physically integrated player locomotion', () => {
  it('moves a requested player on the next tick without moving the ball or uncommanded players', () => {
    const fixture = setup()
    const engine = createFoundationMatch(fixture)
    const original = engine.getState()
    const p = original.players[9]
    const ack = engine.submitCommand(instruction('p1', p.playerId, p.position.xM + 15, p.position.yM))
    expect(ack).toEqual({ accepted: true, commandId: 'p1', sequence: 1, targetTick: 1 })
    expect(engine.getState().players).toEqual(original.players)
    engine.advance()
    const state = engine.getState()
    expect(state.players[9].position.xM).toBeGreaterThan(p.position.xM)
    expect(state.players[0]).toEqual(original.players[0])
    expect(state.ball).toEqual(original.ball)
    expect(state.teams.map((team) => team.score)).toEqual([0, 0])
    expect(state.period).toBe('notStarted')
    expect(state.appliedCommands[0].appliedTick).toBe(1)
  })

  it('enforces bounded acceleration and maximum speed each physics tick', () => {
    const fixture = setup()
    const engine = createFoundationMatch(fixture)
    const p = engine.getState().players[9]
    const definition = fixture.players.find((x) => x.id === p.playerId)!
    const limits = deriveMotionLimits(definition)
    engine.submitCommand(instruction('motion', p.playerId, 104, p.position.yM))
    let previous = p
    for (let i = 0; i < 80; i += 1) {
      engine.advance()
      const current = engine.getState().players[9]
      const speed = Math.hypot(current.velocity.xMps, current.velocity.yMps)
      const change = Math.hypot(
        current.velocity.xMps - previous.velocity.xMps,
        current.velocity.yMps - previous.velocity.yMps,
      )
      expect(speed).toBeLessThanOrEqual(limits.maxSpeedMps + 1e-8)
      expect(change).toBeLessThanOrEqual(
        Math.max(limits.accelerationMps2, limits.brakingMps2) * PLAYER_STEP_SECONDS + 1e-8,
      )
      previous = current
    }
  })

  it('limits turns and does not instantly reverse when aiming behind the player', () => {
    const fixture = setup()
    const engine = createFoundationMatch(fixture)
    const p = engine.getState().players[9]
    const definition = fixture.players.find((x) => x.id === p.playerId)!
    const limit = deriveMotionLimits(definition).turningRadps * PLAYER_STEP_SECONDS
    engine.submitCommand(instruction('backwards', p.playerId, p.position.xM - 14, p.position.yM))
    engine.advance()
    const after = engine.getState().players[9]
    expect(Math.abs(wrapRadians(after.orientationRad - p.orientationRad)))
      .toBeLessThanOrEqual(limit + 1e-8)
    expect(Math.abs(wrapRadians(after.orientationRad - Math.PI))).toBeGreaterThan(1)
  })

  it('comes to a stop near a short target rather than teleporting', () => {
    const fixture = setup()
    const engine = createFoundationMatch(fixture)
    const player = engine.getState().players[9]
    const destination = { xM: player.position.xM + 4, yM: player.position.yM }
    engine.submitCommand(instruction('short', player.playerId, destination.xM, destination.yM))
    engine.advance(800)
    const arrived = engine.getState().players[9]
    expect(arrived.position.xM).toBeCloseTo(destination.xM, 1)
    expect(arrived.position.yM).toBeCloseTo(destination.yM, 1)
    expect(Math.hypot(arrived.velocity.xMps, arrived.velocity.yMps)).toBeLessThan(0.3)
  })

  it('physical attributes change movement outcomes with an identical target', () => {
    const slowFixture = setup()
    const fastFixture = structuredClone(slowFixture)
    const playerId = slowFixture.players[9].id
    const index = 9
    const slow = slowFixture.players[index].abilities.physical
    const quick = fastFixture.players[index].abilities.physical
    ;(slow as { acceleration: number; sprintSpeed: number }).acceleration = 0
    ;(slow as { acceleration: number; sprintSpeed: number }).sprintSpeed = 0
    ;(quick as { acceleration: number; sprintSpeed: number }).acceleration = 100
    ;(quick as { acceleration: number; sprintSpeed: number }).sprintSpeed = 100
    const a = createFoundationMatch(slowFixture)
    const b = createFoundationMatch(fastFixture)
    a.submitCommand(instruction('same', playerId, 104, 34))
    b.submitCommand(instruction('same', playerId, 104, 34))
    a.advance(75)
    b.advance(75)
    expect(b.getState().players[index].position.xM).toBeGreaterThan(a.getState().players[index].position.xM)
  })

  it('rejects wrong team, nonexistent player and nonfinite or out-of-bounds targets', () => {
    const engine = createFoundationMatch(setup())
    const player = engine.getState().players[9]
    const before = engine.checkpoint()
    for (const request of [
      instruction('wrong', player.playerId, 50, 20, 'club_vale'),
      instruction('missing', 'does_not_exist', 50, 20),
      instruction('negative', player.playerId, -1, 20),
      instruction('huge', player.playerId, 106, 20),
      instruction('nan', player.playerId, NaN, 20),
      instruction('inf', player.playerId, Infinity, 20),
      { ...instruction('extra', player.playerId, 50, 20), target: { xM: 50, yM: 20, zM: 0 } },
    ]) {
      expect(engine.submitCommand(request).accepted).toBe(false)
    }
    expect(engine.checkpoint()).toEqual(before)
  })

  it('preserves motion exactly after a mid-stride JSON checkpoint', () => {
    const first = createFoundationMatch(setup())
    const player = first.getState().players[9]
    first.submitCommand(instruction('run', player.playerId, 100, 40))
    first.advance(36)
    const restored = restoreFoundationMatch(JSON.parse(JSON.stringify(first.checkpoint())))
    first.advance(700)
    restored.advance(300)
    restored.advance(400)
    expect(restored.checkpoint()).toEqual(first.checkpoint())
  })

  it('is invariant to advance chunking and seed choice when movement commands match', () => {
    const first = createFoundationMatch(setup())
    const second = createFoundationMatch(setup())
    const id = first.getState().players[9].playerId
    first.submitCommand(instruction('go', id, 100, 55))
    second.submitCommand(instruction('go', id, 100, 55))
    first.advance(700)
    for (const chunk of [1, 4, 35, 60, 200, 400]) second.advance(chunk)
    expect(second.checkpoint()).toEqual(first.checkpoint())
    expect(first.getState().randomStreams).toEqual(
      createFoundationMatch(setup()).getState().randomStreams,
    )
  })

  it('will not accept old checkpoint schema versions as if they were compatible', () => {
    const engine = createFoundationMatch(setup())
    const old = structuredClone(engine.checkpoint())
    ;(old as { checkpointVersion: number }).checkpointVersion = 1
    expect(() => restoreFoundationMatch(old)).toThrow()
  })
})
