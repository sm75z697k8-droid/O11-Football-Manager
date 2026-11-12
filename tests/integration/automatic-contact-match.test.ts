import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { AUTO_CONTACT_COOLDOWN_TICKS } from '../../src/game/physics/automatic-contact'

const setup = makeFictionalMatchSetup
function engage(playerId: string, enabled = true, clubId = 'club_harbor', id = 'engage') {
  return {
    commandId: id, teamId: clubId, type: 'setBallEngagement' as const,
    playerId, enabled,
  }
}
function launch(id = 'rolling-ball', speed = 10) {
  return {
    commandId: id, teamId: 'club_harbor', type: 'diagnosticBallLaunch' as const,
    velocity: { xMps: speed, yMps: 0, zMps: 0 },
  }
}
function intercepted() {
  const engine = createFoundationMatch(setup())
  const striker = engine.getState().players[9]
  expect(engine.submitCommand(engage(striker.playerId)).accepted).toBe(true)
  expect(engine.submitCommand(launch()).accepted).toBe(true)
  engine.advance(100)
  return { engine, striker }
}

describe('Phase 4 automatic interaction in authoritative 22-player engine', () => {
  it('keeps all players disengaged initially and never fabricates a touch', () => {
    const engine = createFoundationMatch(setup())
    expect(engine.getState().players.every(p => p.engagesBall === false)).toBe(true)
    engine.submitCommand(launch())
    engine.advance(100)
    const state = engine.getState()
    expect(state.automaticContactEvents).toEqual([])
    expect(state.ball.controllerId).toBeNull()
    expect(state.contactEvents).toEqual([])
    expect(state.teams.map(t => t.score)).toEqual([0, 0])
  })

  it('automatically intercepts a rolling ball when a player is engaged', () => {
    const { engine, striker } = intercepted()
    const state = engine.getState()
    expect(state.automaticContactEvents).toHaveLength(1)
    const ev = state.automaticContactEvents[0]
    expect(ev.kind).toBe('interception')
    expect(ev.outcome).toBe('intercepted')
    expect(ev.playerId).toBe(striker.playerId)
    expect(ev.tick).toBeGreaterThan(1)
    expect(ev.contactFraction).toBeGreaterThanOrEqual(0)
    expect(ev.contactFraction).toBeLessThanOrEqual(1)
    expect(state.ball.controllerId).toBe(striker.playerId)
    expect(state.ball.lastTouchPlayerId).toBe(striker.playerId)
    expect(state.ballContactCooldownUntilTick).toBe(ev.tick + AUTO_CONTACT_COOLDOWN_TICKS)
    expect(state.randomStreams['ball/contact'].drawCount).toBe(0)
    expect(state.period).toBe('notStarted')
  })

  it('does not generate repeated touches while the same player owns the ball', () => {
    const { engine, striker } = intercepted()
    engine.advance(300)
    expect(engine.getState().automaticContactEvents).toHaveLength(1)
    expect(engine.getState().ball.controllerId).toBe(striker.playerId)
    expect(engine.getState().contactEvents).toHaveLength(0)
  })

  it('keeps engagement as next-tick authority and validates team ownership', () => {
    const engine = createFoundationMatch(setup())
    const pid = engine.getState().players[9].playerId
    const previous = engine.getState()
    const rejected = [
      { ...engage(pid, true, 'club_vale', 'wrong') },
      { ...engage(pid, true, 'club_harbor', 'malformed'), enabled: 'true' },
      { ...engage(pid, true, 'club_harbor', 'extra'), mystery: 1 },
      engage('missing-id', true, 'club_harbor', 'missing'),
    ]
    for (const request of rejected) {
      expect(engine.submitCommand(request).accepted).toBe(false)
    }
    expect(engine.submitCommand(engage(pid)).accepted).toBe(true)
    expect(engine.getState().players).toEqual(previous.players)
    engine.advance()
    expect(engine.getState().players[9].engagesBall).toBe(true)
    expect(engine.submitCommand(engage(pid, false, 'club_harbor', 'off')).accepted).toBe(true)
    engine.advance()
    expect(engine.getState().players[9].engagesBall).toBe(false)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint()).toEqual(engine.checkpoint())
  })

  it('replays a real automatic interception after an arbitrary checkpoint split', () => {
    const engine = createFoundationMatch(setup())
    const pid = engine.getState().players[9].playerId
    engine.submitCommand(engage(pid))
    engine.submitCommand(launch())
    engine.advance(24)
    const snapshot = JSON.parse(JSON.stringify(engine.checkpoint()))
    const continued = restoreFoundationMatch(snapshot)
    engine.advance(200)
    for (const n of [1, 17, 27, 50, 105]) continued.advance(n)
    expect(continued.checkpoint()).toEqual(engine.checkpoint())
    expect(engine.getState().automaticContactEvents).toHaveLength(1)
  })

  it('uses activated movement plus swept contact to acquire a stationary ball', () => {
    const engine = createFoundationMatch(setup())
    const p = engine.getState().players[9]
    engine.submitCommand(engage(p.playerId))
    engine.submitCommand({
      commandId: 'run-to-ball', teamId: p.clubId, type: 'setMovementTarget',
      playerId: p.playerId, target: { xM: 52.5, yM: 34 },
    })
    engine.advance(180)
    const state = engine.getState()
    expect(state.automaticContactEvents.length).toBeGreaterThan(0)
    expect(state.automaticContactEvents[0].outcome).toBe('intercepted')
    expect(state.ball.controllerId).toBe(p.playerId)
    expect(state.players[9].position.xM).toBeLessThan(p.position.xM)
  })

  it('resolves an opponent challenge instead of permanently locking possession', () => {
    const { engine, striker } = intercepted()
    const opponent = engine.getState().players[20]
    engine.submitCommand(engage(opponent.playerId, true, opponent.clubId, 'defender-engages'))
    engine.submitCommand({
      commandId: 'defender-chases', teamId: opponent.clubId,
      type: 'setMovementTarget', playerId: opponent.playerId,
      target: { xM: striker.position.xM, yM: striker.position.yM },
    })
    engine.advance(400)
    const challenges = engine.getState().automaticContactEvents.filter(e =>
      e.kind === 'challenge')
    expect(challenges.length).toBeGreaterThan(0)
    expect(['wonChallenge', 'heldOff']).toContain(challenges[0].outcome)
    expect(challenges[0].playerId).toBe(opponent.playerId)
    expect(engine.getState().teams.map(t => t.score)).toEqual([0, 0])
  })

  it('rejects forged automatic events, cooldowns and engagement history at restore', () => {
    const { engine } = intercepted()
    const snapshot = engine.checkpoint()
    const changes: ((data: any) => void)[] = [
      s => { s.state.automaticContactEvents[0].playerId = 'imposter' },
      s => { s.state.automaticContactEvents[0].kind = 'challenge' },
      s => { s.state.automaticContactEvents[0].outcome = 'wonChallenge' },
      s => { s.state.automaticContactEvents[0].tick = 999999 },
      s => { s.state.automaticContactEvents[0].contactFraction = NaN },
      s => { s.state.ballContactCooldownUntilTick = 0 },
      s => { s.state.players[9].engagesBall = false },
      s => { s.state.ball.controllerId = 'vale_player_01' },
      s => { s.state.automaticContactEvents.push(s.state.automaticContactEvents[0]) },
      s => { s.state.appliedCommands[0].teamId = 'club_vale' },
      s => { s.checkpointVersion = 4 },
    ]
    for (const change of changes) {
      const clone = structuredClone(snapshot)
      change(clone)
      expect(() => restoreFoundationMatch(clone)).toThrow()
    }
  })

  it('retains Phase 3 explicit commands without enabling automatic engagement', () => {
    const engine = createFoundationMatch(setup())
    const pid = engine.getState().players[9].playerId
    engine.submitCommand(launch())
    engine.advance(52)
    engine.submitCommand({
      commandId: 'explicit-first-touch', teamId: 'club_harbor',
      type: 'attemptFirstTouch', playerId: pid,
    })
    engine.advance()
    expect(engine.getState().contactEvents[0].outcome).toBe('controlled')
    expect(engine.getState().automaticContactEvents).toEqual([])
    expect(engine.getState().ball.controllerId).toBe(pid)
  })
})
