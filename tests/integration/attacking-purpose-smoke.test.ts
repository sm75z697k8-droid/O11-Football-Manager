import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'

/** Reports what the real seeded exhibition does, not an arranged shootout. */
describe('Live exhibition attacking intelligence diagnostic', () => {
  it('observes actual passes, territorial progression and shot opportunities', () => {
    const session = new MatchViewerSession()
    let farthestHomePossessionX = 0
    let farthestAwayPossessionX = 105
    for (let i = 0; i < 200 && !session.state.ball.outsidePitch; i += 1) {
      session.advance(8)
      const ball = session.state.ball
      const owner = session.state.players.find(p => p.playerId === ball.controllerId)
      if (owner?.clubId === 'club_harbor') {
        farthestHomePossessionX = Math.max(farthestHomePossessionX, ball.position.xM)
      } else if (owner?.clubId === 'club_vale') {
        farthestAwayPossessionX = Math.min(farthestAwayPossessionX, ball.position.xM)
      }
    }
    const s = session.state
    const attemptedShots = s.appliedCommands.filter(c =>
      c.type === 'attemptKick' && c.commandId.startsWith('ai-shot-'))
    const attemptedPasses = s.appliedCommands.filter(c =>
      c.type === 'attemptKick' && c.commandId.startsWith('ai-pass-'))
    console.info('[O11 live attacking baseline] ' + JSON.stringify({
      source: 'actual fictional iPhone exhibition fixture under Node, not Safari',
      ticks: s.clock.tick, seconds: s.clock.tick * .05,
      shotAttempts: attemptedShots.length,
      passAttempts: attemptedPasses.length,
      allContacts: s.contactEvents.length,
      homeMaxX: +farthestHomePossessionX.toFixed(1),
      awayMinX: +farthestAwayPossessionX.toFixed(1),
      goals: s.goalEvents, outOfPlay: s.ball.outsidePitch,
      recentKicks: s.appliedCommands.filter(c => c.type === 'attemptKick').slice(-14)
        .map(c => ({ id: c.commandId, by: c.playerId, to: c.target,
          power: c.power })),
      finalBall: s.ball.position, finalTouch: s.ball.lastTouchPlayerId,
    }))
    expect(s.kickoff?.phase).toBe('inPlay')
    expect(s.contactEvents[0].outcome).toBe('kicked')
    expect(s.appliedCommands.length).toBeGreaterThanOrEqual(3)
    expect(attemptedShots.length).toBeGreaterThanOrEqual(1)
    expect(s.contactEvents.some(e =>
      e.commandId.startsWith('ai-shot-') && e.outcome === 'kicked')).toBe(true)
    expect(s.goalEvents.length).toBeLessThanOrEqual(1)
    expect(s.teams.map(t => t.score).reduce((a, b) => a + b, 0))
      .toBe(s.goalEvents.length)
  })
})
