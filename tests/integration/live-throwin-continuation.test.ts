import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { restoreFoundationMatch } from '../../src/game/match/engine'

describe('S1.1 complete live seeded throw-in continuation', () => {
  it('actually awards and executes a throw-in in running 2-team match physics', () => {
    const examined = []
    let completed = false
    // Physical foot-control changes legitimately change which sideline
    // exits a fixed exhibition seed produces. Scan a broader deterministic
    // sample for a REAL throw-in; never synthesize an award or release.
    for (const seed of [42, 117, 123456789, 832, 90, 205,
      4100, 9999, 7654321, 23017, 101, 57]) {
      const session = new MatchViewerSession(seed)
      let sawThrowIn = false
      let sawRelease = false
      // A full restart can take several real simulated seconds for the
      // selected taker and teammates to reach the sideline positions.
      for (let step = 0; step < 3000; step += 8) {
        session.advance(8)
        const live = session.state
        sawThrowIn ||= live.outOfPlayEvents.some(e => e.kind === 'throwIn')
        sawRelease ||= live.contactEvents.some(e => e.outcome === 'thrownIn')
        if (sawRelease) break
        if (live.goalEvents.length ||
            (live.restart && live.restart.kind !== 'throwIn')) break
      }
      const state = session.state
      examined.push({
        seed, tick: state.clock.tick, awarded: sawThrowIn,
        release: sawRelease, exit: state.restart?.kind ?? null,
      })
      if (!sawRelease) continue
      completed = true
      expect(state.contactEvents.some(e => e.kind === 'throwIn' &&
        e.outcome === 'thrownIn' && e.drawUsed === 1)).toBe(true)
      expect(state.restart).toBeNull()
      expect(state.ball.outsidePitch).toBe(false)
      const restored = restoreFoundationMatch(session.checkpoint())
      const checkpoint = restored.checkpoint()
      expect(checkpoint.state).toEqual(state)
      const following = session.advance(8)
      restored.advance(8)
      expect(following).toEqual(restored.getState())
      break
    }
    console.info('[O11 S1.1 LIVE RESTART SAMPLE]', JSON.stringify(examined))
    expect(completed).toBe(true)
  }, 20_000)
})
