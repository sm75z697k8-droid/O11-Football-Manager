import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'

const impulse = (id: string, xMps: number, yMps: number, zMps: number,
  teamId = 'club_harbor') => ({
  commandId: id, teamId,
  type: 'diagnosticBallLaunch' as const,
  velocity: { xMps, yMps, zMps },
})

describe('Phase 2 ball physics integration with two fictional teams', () => {
  it('queues ball launch for the next tick and does not fabricate a goal or touch', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const before = engine.getState()
    expect(engine.submitCommand(impulse('shot-test', 12, 0, 0))).toEqual({
      accepted: true, commandId: 'shot-test', targetTick: 1, sequence: 1,
    })
    expect(engine.getState().ball).toEqual(before.ball)
    engine.advance(1)
    const after = engine.getState()
    expect(after.ball.position.xM).toBeGreaterThan(before.ball.position.xM)
    expect(after.ball.heightM).toBe(BALL_RADIUS_M)
    expect(after.ball.controllerId).toBeNull()
    expect(after.ball.lastTouchPlayerId).toBeNull()
    expect(after.players).toEqual(before.players)
    expect(after.teams.map((t) => t.score)).toEqual([0, 0])
    expect(after.period).toBe('notStarted')
    expect(after.appliedCommands[0].appliedTick).toBe(1)
  })

  it('plays an airborne diagnostic test on the same 105×68m coordinate space', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.submitCommand(impulse('chip', 16, 4, 8))
    engine.advance(12)
    const ball = engine.getState().ball
    expect(ball.position.xM).toBeGreaterThan(52.5)
    expect(ball.position.yM).toBeGreaterThan(34)
    expect(ball.heightM).toBeGreaterThan(BALL_RADIUS_M)
    expect(ball.velocity.zMps).toBeGreaterThan(0)
    expect(engine.getState().players).toHaveLength(22)
  })

  it('rejects bad team IDs, velocity caps, invalid components and duplicate IDs', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const valid = impulse('valid', 12, 0, 2)
    expect(engine.submitCommand(valid).accepted).toBe(true)
    const before = engine.checkpoint()
    for (const bad of [
      valid,
      impulse('wrong', 12, 0, 2, 'unknown-team'),
      impulse('huge', 100, 0, 0),
      impulse('negative', 1, 0, -2),
      impulse('nan', NaN, 1, 1),
      impulse('zero', 0, 0, 0),
      { ...impulse('extra', 10, 0, 0), velocity: { xMps: 10, yMps: 0, zMps: 0, secret: true } },
      { ...impulse('junk', 10, 0, 0), unexpected: true },
    ]) {
      expect(engine.submitCommand(bad).accepted).toBe(false)
    }
    expect(engine.checkpoint()).toEqual(before)
  })

  it('copies command velocity so a caller cannot mutate the scheduled impulse', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const request = impulse('immutable', 10, 0, 3)
    expect(engine.submitCommand(request).accepted).toBe(true)
    request.velocity.xMps = 999
    expect(engine.getState().pendingCommands[0]).toMatchObject({
      velocity: { xMps: 10, yMps: 0, zMps: 3 },
    })
  })

  it('retains physically moving ball state through JSON checkpoints', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.submitCommand(impulse('flight', 20, 2, 7))
    engine.advance(24)
    const midflight = engine.checkpoint()
    const restored = restoreFoundationMatch(JSON.parse(JSON.stringify(midflight)))
    expect(restored.checkpoint()).toEqual(midflight)
    engine.advance(1000)
    restored.advance(600)
    restored.advance(400)
    expect(JSON.stringify(restored.checkpoint())).toBe(JSON.stringify(engine.checkpoint()))
  })

  it('replays the same ball after different advance chunk sizes', () => {
    const first = createFoundationMatch(makeFictionalMatchSetup())
    const second = createFoundationMatch(makeFictionalMatchSetup())
    first.submitCommand(impulse('kick', 17, 8, 11))
    second.submitCommand(impulse('kick', 17, 8, 11))
    first.advance(800)
    for (const part of [5, 11, 37, 67, 100, 220, 360]) second.advance(part)
    expect(second.checkpoint()).toEqual(first.checkpoint())
  })

  it('applies same-tick launches deterministically in submission sequence', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.submitCommand(impulse('a', 10, 0, 0))
    engine.submitCommand(impulse('b', 0, 12, 0, 'club_vale'))
    engine.advance()
    expect(engine.getState().appliedCommands.map((c) => c.commandId)).toEqual(['a', 'b'])
    expect(engine.getState().ball.position.yM).toBeGreaterThan(34)
    expect(engine.getState().ball.position.xM).toBe(52.5)
  })

  it('can run player locomotion and independent ball physics in the same tick', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const player = engine.getState().players[9]
    engine.submitCommand(impulse('ball', 12, 1, 3))
    engine.submitCommand({
      commandId: 'player', teamId: player.clubId, type: 'setMovementTarget',
      playerId: player.playerId,
      target: { xM: player.position.xM + 8, yM: player.position.yM },
    })
    engine.advance(40)
    const state = engine.getState()
    expect(state.players[9].position.xM).toBeGreaterThan(player.position.xM)
    expect(state.ball.position.xM).toBeGreaterThan(52.5)
    expect(state.ball.controllerId).toBeNull()
    expect(state.teams[0].score).toBe(0)
  })

  it('detects the ball leaving the field without a false goal event', () => {
    const fixture = makeFictionalMatchSetup()
    const engine = createFoundationMatch(fixture)
    engine.submitCommand(impulse('longball', 36, 0, 0))
    engine.advance(45)
    const ball = engine.getState().ball
    expect(ball.outsidePitch).toBe(true)
    expect(ball.position.xM).toBeGreaterThan(fixture.pitch.lengthM)
    expect(engine.getState().teams.map((t) => t.score)).toEqual([0, 0])
    expect(engine.getState().period).toBe('notStarted')
  })

  it('rejects corrupted ball checkpoints, including impossible speed or forged touches', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.submitCommand(impulse('verify', 20, 0, 5))
    engine.advance(12)
    const base = engine.checkpoint()
    const mutate = (update: (clone: any) => void) => {
      const cloned = structuredClone(base)
      update(cloned)
      expect(() => restoreFoundationMatch(cloned)).toThrow()
    }
    mutate((p) => { p.state.ball.velocity.xMps = NaN })
    mutate((p) => { p.state.ball.velocity.xMps = 800 })
    mutate((p) => { p.state.ball.heightM = -1 })
    mutate((p) => { p.state.ball.controllerId = 'harbor_player_01' })
    mutate((p) => { p.state.ball.lastTouchPlayerId = 'vale_player_01' })
    mutate((p) => { p.state.ball.outsidePitch = true })
    mutate((p) => { p.state.appliedCommands[0].velocity.zMps = -50 })
    mutate((p) => { p.checkpointVersion = 2 })
    mutate((p) => { p.state.schemaVersion = 2 })
  })

  it('keeps ball stationary when moving only players', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const player = engine.getState().players[9]
    const initial = engine.getState().ball
    engine.submitCommand({
      commandId: 'only-run', type: 'setMovementTarget', teamId: player.clubId,
      playerId: player.playerId,
      target: { xM: Math.min(105, player.position.xM + 7), yM: player.position.yM },
    })
    engine.advance(200)
    expect(engine.getState().ball).toEqual(initial)
  })
})
