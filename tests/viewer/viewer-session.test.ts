import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { restoreFoundationMatch } from '../../src/game/match/engine'

describe('Phase 6 real simulation viewer session', () => {
  it('starts at the genuine fixture with two queued AI enable commands', () => {
    const session = new MatchViewerSession()
    expect(session.setup.clubs.map(c => c.name)).toEqual(['Harbor Athletic', 'Vale Rovers'])
    expect(session.state.players).toHaveLength(22)
    expect(session.state.ball.position).toEqual({ xM: 52.5, yM: 34 })
    expect(session.state.ai.enabledTeams).toEqual([false, false])
    expect(session.state.pendingCommands.map(c => c.type)).toEqual([
      'setAutonomousTeam', 'setAutonomousTeam',
    ])
    expect(session.state.clock.tick).toBe(0)
  })

  it('steps both autonomous teams and retains adjacent real physics snapshots', () => {
    const session = new MatchViewerSession()
    session.advance(8)
    expect(session.state.clock.tick).toBe(8)
    expect(session.previous.clock.tick).toBe(7)
    expect(session.state.ai.enabledTeams).toEqual([true, true])
    expect(session.state.players.some((p, i) =>
      p.position.xM !== session.previous.players[i].position.xM ||
      p.position.yM !== session.previous.players[i].position.yM)).toBe(true)
    expect(session.state.period).toBe('notStarted')
    expect(session.state.teams.map(t => t.score)).toEqual([0, 0])
  })

  it('never draws an independent or fabricated gameplay state', () => {
    const session = new MatchViewerSession()
    session.advance(8)
    expect(session.state).toEqual(session.checkpoint().state)
    expect(restoreFoundationMatch(session.checkpoint()).checkpoint()).toEqual(session.checkpoint())
  })

  it('restarts deterministically with the same seeded fictional fixture', () => {
    const first = new MatchViewerSession()
    first.advance(8)
    const second = new MatchViewerSession()
    second.advance(8)
    expect(second.checkpoint()).toEqual(first.checkpoint())
    const reset = new MatchViewerSession()
    expect(reset.state.clock.tick).toBe(0)
    expect(reset.state.ball.controllerId).toBeNull()
    expect(reset.state.contactEvents).toEqual([])
  })

  it('limits per-frame physical ticks to protect iPhone Safari', () => {
    const session = new MatchViewerSession()
    for (const count of [-1, 0.5, 9, Infinity, NaN]) {
      expect(() => session.advance(count)).toThrow()
    }
    expect(session.state.clock.tick).toBe(0)
  })
})
