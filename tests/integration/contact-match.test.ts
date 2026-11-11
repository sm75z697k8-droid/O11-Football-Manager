import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { FOOT_REACH_M, canReachBall } from '../../src/game/physics/contact'
import { BALL_RADIUS_M } from '../../src/game/physics/ball'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

const roll = (speed = 10) => ({
  commandId: 'ball-launch', teamId: 'club_harbor',
  type: 'diagnosticBallLaunch' as const,
  velocity: { xMps: speed, yMps: 0, zMps: 0 },
})
const control = (playerId: string, commandId = 'touch') => ({
  commandId, teamId: 'club_harbor',
  type: 'attemptFirstTouch' as const, playerId,
})
const kick = (playerId: string, commandId = 'kick', power = 0.8, lift = 0) => ({
  commandId, teamId: 'club_harbor', type: 'attemptKick' as const, playerId,
  target: { xM: 102, yM: 36 }, power, lift,
})
function approachingFixture(seed = 123456789, speed = 10) {
  const fixture = { ...makeFictionalMatchSetup(), seed }
  const engine = createFoundationMatch(fixture)
  expect(engine.submitCommand(roll(speed)).accepted).toBe(true)
  // With rolling deceleration, the ball reaches the static Harbor striker
  // near 76.65m at tick 53 (or tick 12 for a 40m/s approach).
  engine.advance(speed === 40 ? 11 : 52)
  return { engine, striker: engine.getState().players[9] }
}
function capturedFixture() {
  const { engine, striker } = approachingFixture()
  expect(engine.submitCommand(control(striker.playerId)).accepted).toBe(true)
  engine.advance()
  expect(engine.getState().contactEvents.at(-1)?.outcome).toBe('controlled')
  return { engine, striker }
}

describe('Phase 3 authentic geometric player-ball interactions', () => {
  it('requires a contact request and actual physical reach, never auto awards a first touch', () => {
    const { engine, striker } = approachingFixture()
    expect(engine.getState().ball.controllerId).toBeNull()
    expect(engine.getState().ball.lastTouchPlayerId).toBeNull()
    expect(engine.getState().contactEvents).toEqual([])
    expect(canReachBall(striker, engine.getState().ball)).toBe(true)
    engine.advance()
    expect(canReachBall(striker, engine.getState().ball)).toBe(true)
    expect(FOOT_REACH_M).toBeLessThanOrEqual(1.2)
    expect(engine.getState().ball.controllerId).toBeNull()
  })

  it('records a successful controlled first touch, with one seeded RNG draw', () => {
    const { engine, striker } = capturedFixture()
    const state = engine.getState()
    expect(state.ball.controllerId).toBe(striker.playerId)
    expect(state.ball.lastTouchPlayerId).toBe(striker.playerId)
    expect(state.ball.controlOffset).not.toBeNull()
    expect(state.ball.heightM).toBe(BALL_RADIUS_M)
    expect(state.contactEvents).toEqual([{
      commandId: 'touch', playerId: striker.playerId, tick: 53,
      kind: 'control', outcome: 'controlled', drawUsed: 1,
    }])
    expect(state.randomStreams['ball/contact'].drawCount).toBe(1)
    expect(state.teams.map((t) => t.score)).toEqual([0, 0])
    expect(state.period).toBe('notStarted')
  })

  it('attaches the controlled ball to its actual moving player without generating a pass', () => {
    const { engine, striker } = capturedFixture()
    const original = engine.getState()
    const offset = original.ball.controlOffset!
    engine.submitCommand({
      commandId: 'move-after-control', teamId: 'club_harbor',
      type: 'setMovementTarget', playerId: striker.playerId,
      target: { xM: striker.position.xM + 7, yM: striker.position.yM + 2 },
    })
    engine.advance(50)
    const state = engine.getState()
    expect(state.players[9].position.xM).toBeGreaterThan(striker.position.xM)
    expect(state.ball.position.xM).toBeCloseTo(
      state.players[9].position.xM + offset.xM, 9)
    expect(state.ball.position.yM).toBeCloseTo(
      state.players[9].position.yM + offset.yM, 9)
    expect(state.ball.velocity.xMps).toBe(state.players[9].velocity.xMps)
    expect(state.ball.controllerId).toBe(striker.playerId)
    expect(state.contactEvents).toHaveLength(1)
  })

  it('releases a controlled ball with a real impulse based on position and football attributes', () => {
    const { engine, striker } = capturedFixture()
    expect(engine.submitCommand(kick(striker.playerId)).accepted).toBe(true)
    engine.advance()
    const ball = engine.getState().ball
    expect(ball.controllerId).toBeNull()
    expect(ball.controlOffset).toBeNull()
    expect(ball.lastTouchPlayerId).toBe(striker.playerId)
    expect(ball.velocity.xMps).toBeGreaterThan(5)
    expect(engine.getState().contactEvents.map((e) => e.outcome)).toEqual(['controlled', 'kicked'])
    expect(engine.getState().randomStreams['ball/contact'].drawCount).toBe(2)
  })

  it('supports a lofted kick whose height evolves from real ball physics', () => {
    const { engine, striker } = capturedFixture()
    engine.submitCommand(kick(striker.playerId, 'loft', 0.9, 0.85))
    engine.advance()
    expect(engine.getState().ball.velocity.zMps).toBeGreaterThan(2)
    engine.advance(6)
    expect(engine.getState().ball.heightM).toBeGreaterThan(BALL_RADIUS_M)
    expect(engine.getState().ball.controllerId).toBeNull()
  })

  it('miscontrols physically difficult incoming balls instead of claiming possession', () => {
    const { engine, striker } = approachingFixture(123456789, 40)
    engine.submitCommand(control(striker.playerId))
    engine.advance()
    const state = engine.getState()
    expect(state.contactEvents[0].outcome).toBe('miscontrolled')
    expect(state.contactEvents[0].drawUsed).toBe(1)
    expect(state.ball.controllerId).toBeNull()
    expect(state.ball.lastTouchPlayerId).toBe(striker.playerId)
    expect(Math.hypot(state.ball.velocity.xMps, state.ball.velocity.yMps)).toBeLessThan(40)
  })

  it('skill attributes change a difficult first-touch outcome', () => {
    const base = makeFictionalMatchSetup()
    const lowFixture = structuredClone(base)
    const highFixture = structuredClone(base)
    const low = lowFixture.players[9].abilities
    const high = highFixture.players[9].abilities
    ;(low.technical as {firstTouch: number; technique: number}).firstTouch = 0
    ;(low.technical as {firstTouch: number; technique: number}).technique = 0
    ;(low.mental as {composure: number}).composure = 0
    ;(low.physical as {balance: number}).balance = 0
    ;(high.technical as {firstTouch: number; technique: number}).firstTouch = 100
    ;(high.technical as {firstTouch: number; technique: number}).technique = 100
    ;(high.mental as {composure: number}).composure = 100
    ;(high.physical as {balance: number}).balance = 100
    const a = createFoundationMatch(lowFixture)
    const b = createFoundationMatch(highFixture)
    a.submitCommand(roll())
    b.submitCommand(roll())
    a.advance(52)
    b.advance(52)
    const pid = base.players[9].id
    a.submitCommand(control(pid))
    b.submitCommand(control(pid))
    a.advance()
    b.advance()
    expect(a.getState().contactEvents[0].outcome).toBe('miscontrolled')
    expect(b.getState().contactEvents[0].outcome).toBe('controlled')
  })

  it('attributes affect physical power and seeded execution variation affects kick direction', () => {
    const base = makeFictionalMatchSetup()
    const weak = structuredClone(base)
    const strong = structuredClone(base)
    ;(weak.players[9].abilities.physical as {strength: number}).strength = 0
    ;(weak.players[9].abilities.technical as {technique: number}).technique = 0
    ;(strong.players[9].abilities.physical as {strength: number}).strength = 100
    ;(strong.players[9].abilities.technical as {technique: number}).technique = 100
    const a = createFoundationMatch(weak)
    const b = createFoundationMatch(strong)
    a.submitCommand(roll()); b.submitCommand(roll())
    a.advance(52); b.advance(52)
    a.submitCommand(kick(base.players[9].id, 'kick-attributes', 0.9))
    b.submitCommand(kick(base.players[9].id, 'kick-attributes', 0.9))
    a.advance(); b.advance()
    expect(a.getState().contactEvents[0].outcome).toBe('kicked')
    expect(b.getState().contactEvents[0].outcome).toBe('kicked')
    const speed = (engine: typeof a) => Math.hypot(
      engine.getState().ball.velocity.xMps, engine.getState().ball.velocity.yMps,
    )
    expect(speed(b)).toBeGreaterThan(speed(a))
    const other = createFoundationMatch({ ...base, seed: 3 })
    other.submitCommand(roll())
    other.advance(52)
    other.submitCommand(kick(base.players[9].id, 'kick-attributes', 0.9))
    other.advance()
    expect(other.getState().ball.velocity).not.toEqual(
      createSeedOriginalKick(base).getState().ball.velocity)
  })

  it('records out-of-reach commands without moving the ball or consuming random draws', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const start = engine.getState().ball
    expect(engine.submitCommand(control(engine.getState().players[9].playerId)).accepted).toBe(true)
    engine.advance()
    expect(engine.getState().contactEvents[0].outcome).toBe('outOfReach')
    expect(engine.getState().contactEvents[0].drawUsed).toBe(0)
    expect(engine.getState().ball).toEqual(start)
    expect(engine.getState().randomStreams['ball/contact'].drawCount).toBe(0)
  })

  it('refuses foot interaction when the ball is too high even at close range', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const player = engine.getState().players[9]
    const ball = engine.getState().ball
    expect(canReachBall(player, {
      ...ball, position: { ...player.position },
      heightM: 1.4,
    })).toBe(false)
    expect(canReachBall(player, {
      ...ball, position: { ...player.position },
      heightM: 0.11,
    })).toBe(true)
  })

  it('refuses an opponent touching a controlled ball and prevents double control', () => {
    const { engine, striker } = capturedFixture()
    engine.submitCommand(control(striker.playerId, 'again'))
    engine.submitCommand({
      ...control(engine.getState().players[20].playerId, 'opponent'),
      teamId: 'club_vale',
    })
    engine.advance()
    expect(engine.getState().contactEvents.map((e) => e.outcome))
      .toEqual(['controlled', 'alreadyControlled', 'occupied'])
    expect(engine.getState().randomStreams['ball/contact'].drawCount).toBe(1)
  })

  it('rejects other-team players, nonexistent players, forged targets and invalid kick power', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const pid = engine.getState().players[9].playerId
    const original = engine.checkpoint()
    const requests = [
      { ...control(pid, 'enemy'), teamId: 'club_vale' },
      control('not-a-player', 'absent'),
      { ...kick(pid, 'negative'), power: -0.1 },
      { ...kick(pid, 'overpower'), power: 2 },
      { ...kick(pid, 'nan'), lift: Number.NaN },
      { ...kick(pid, 'outside'), target: { xM: 107, yM: 30 } },
      { ...kick(pid, 'extra'), extra: true },
    ]
    for (const req of requests) expect(engine.submitCommand(req).accepted).toBe(false)
    expect(engine.checkpoint()).toEqual(original)
  })

  it('can resume from an owned ball and then a post-kick flight with exact replay', () => {
    const { engine, striker } = capturedFixture()
    const storedControl = JSON.parse(JSON.stringify(engine.checkpoint()))
    const recovered = restoreFoundationMatch(storedControl)
    expect(recovered.checkpoint()).toEqual(engine.checkpoint())
    engine.submitCommand(kick(striker.playerId))
    recovered.submitCommand(kick(striker.playerId))
    engine.advance(130)
    recovered.advance(45)
    recovered.advance(85)
    expect(recovered.checkpoint()).toEqual(engine.checkpoint())
  })

  it('clears ownership and last touch on a later diagnostic launch', () => {
    const { engine } = capturedFixture()
    expect(engine.submitCommand({
      commandId: 'reset-ball', teamId: 'club_vale', type: 'diagnosticBallLaunch',
      velocity: { xMps: 4, yMps: 0, zMps: 0 },
    }).accepted).toBe(true)
    engine.advance()
    const ball = engine.getState().ball
    expect(ball.controllerId).toBeNull()
    expect(ball.controlOffset).toBeNull()
    expect(ball.lastTouchPlayerId).toBeNull()
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint()).toEqual(engine.checkpoint())
  })

  it('rejects modified contact history, controller offsets and RNG checkpoints', () => {
    const { engine } = capturedFixture()
    const baseline = engine.checkpoint()
    const mutate = (change: (copy: any) => void) => {
      const cp = structuredClone(baseline)
      change(cp)
      expect(() => restoreFoundationMatch(cp)).toThrow()
    }
    mutate((cp) => { cp.state.contactEvents[0].playerId = 'forged' })
    mutate((cp) => { cp.state.contactEvents[0].outcome = 'kicked' })
    mutate((cp) => { cp.state.contactEvents[0].drawUsed = 0 })
    mutate((cp) => { cp.state.contactEvents.push(cp.state.contactEvents[0]) })
    mutate((cp) => { cp.state.randomStreams['ball/contact'].drawCount = 0 })
    mutate((cp) => { cp.state.ball.controllerId = 'vale_player_01' })
    mutate((cp) => { cp.state.ball.controlOffset.xM = 200 })
    mutate((cp) => { cp.state.ball.position.xM += 1 })
    mutate((cp) => { cp.state.ball.lastTouchPlayerId = null })
    mutate((cp) => { cp.checkpointVersion = 3 })
    mutate((cp) => { cp.state.schemaVersion = 3 })
  })

  it('leaves pitch time and scores untouched after any number of contact attempts', () => {
    const { engine, striker } = capturedFixture()
    engine.submitCommand(kick(striker.playerId))
    engine.advance(250)
    expect(engine.getState().period).toBe('notStarted')
    expect(engine.getState().teams.map((t) => t.score)).toEqual([0, 0])
  })
})

function createSeedOriginalKick(fixture: ReturnType<typeof makeFictionalMatchSetup>) {
  const engine = createFoundationMatch(fixture)
  engine.submitCommand(roll())
  engine.advance(52)
  engine.submitCommand(kick(fixture.players[9].id, 'kick-attributes', 0.9))
  engine.advance()
  return engine
}
