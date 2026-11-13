import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'

const REPORTED_SEED = 0x8BE673A4
const REPORTED_TIME_TICKS = 9 * 60 * 20 + 42 * 20

/** Seed supplied by iPhone user: the game visibly freezes around 09:42
 * while physical-contact counts still climb. Check the real engine, not a
 * fabricated position or a manually constructed command counter.
 */
describe('Reported seed 8BE673A4 late-match command exhaustion', () => {
  it('can continue choosing and physically kicking actions after the historical 256-command limit', () => {
    const session = new MatchViewerSession(REPORTED_SEED)
    const samples: Array<{
      tick: number; commands: number; contacts: number;
      automatic: number; controller: string | null; lastKickTick: number;
      out: boolean; goals: number;
    }> = []
    let nextSampleTick = 1600
    let lastKickTick = 0
    let stalledSinceTick: number | null = null
    let previousPosition = { ...session.state.ball.position }
    let stationaryTicks = 0

    // Extra time past 09:42 ensures a genuine late-game command
    // (not merely a still-running physics clock) is observed.
    for (let i = 0; i < 1950; i += 1) {
      session.advance(8)
      const s = session.state
      const latest = s.contactEvents.at(-1)
      if (latest?.outcome === 'kicked' && latest.tick > lastKickTick)
        lastKickTick = latest.tick
      const displacement = Math.hypot(
        s.ball.position.xM - previousPosition.xM,
        s.ball.position.yM - previousPosition.yM)
      if (displacement < .025) {
        stationaryTicks += 8
        if (stationaryTicks >= 600 && stalledSinceTick === null)
          stalledSinceTick = s.clock.tick - stationaryTicks
      } else {
        stationaryTicks = 0
      }
      previousPosition = s.ball.position

      if (s.clock.tick >= nextSampleTick) {
        samples.push({
          tick: s.clock.tick,
          commands: s.appliedCommands.length,
          contacts: s.contactEvents.length,
          automatic: s.automaticContactEvents.length,
          controller: s.ball.controllerId,
          lastKickTick,
          out: s.ball.outsidePitch,
          goals: s.goalEvents.length,
        })
        nextSampleTick += 1600
      }
      if (s.ball.outsidePitch || s.goalEvents.length > 0) break
    }
    const s = session.state
    console.info('[O11 USER SEED 8BE673A4 09:42]', JSON.stringify({
      seed: REPORTED_SEED,
      reportedTick: REPORTED_TIME_TICKS,
      reachedTick: s.clock.tick,
      commands: s.appliedCommands.length,
      lastKickTick,
      stalledSinceTick,
      automatic: s.automaticContactEvents.length,
      out: s.ball.outsidePitch,
      goals: s.goalEvents.length,
      samples,
    }))
    expect(s.clock.tick).toBeGreaterThanOrEqual(REPORTED_TIME_TICKS)
    // Unlike a running clock with no legal new AI action, the engine must
    // actually continue issuing commands beyond its old 256-command cap.
    expect(s.appliedCommands.length).toBeGreaterThan(256)
    expect(lastKickTick).toBeGreaterThan(REPORTED_TIME_TICKS - 1200)
  }, 120_000)
})
