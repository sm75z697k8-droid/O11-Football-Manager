import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import {
  outgoingKickStillSeparating, resolveAutomaticBallContact,
} from '../../src/game/physics/automatic-contact'
import { advanceBallPhysics, BALL_RADIUS_M } from '../../src/game/physics/ball'
import type { MatchState } from '../../src/game/match/state'

function actualKick(side: 0 | 1, kind: 'shot' | 'pass' = 'shot',
  blocked = false) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const team = initial.teams[side]
  const dx = team.attackingDirection
  const striker = initial.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'ST')!
  const defender = initial.players.find(p =>
    p.clubId !== team.clubId && p.formationSlot === 'RCB')!
  const start = { xM: side === 0 ? 84 : 21, yM: 34 }
  const players = initial.players.map(p => {
    const isStriker = p.playerId === striker.playerId
    const isDefender = p.playerId === defender.playerId
    return {
      ...p,
      position: isStriker ? start :
        isDefender ? { xM: start.xM + dx * (blocked ? 1.80 : 16), yM: 34 }
          : p.position,
      orientationRad: isStriker ? (dx === 1 ? 0 : Math.PI)
        : p.orientationRad,
      velocity: { xMps: 0, yMps: 0 },
      engagesBall: isStriker || isDefender,
    }
  })
  const kicker = players.find(p => p.playerId === striker.playerId)!
  const ball = {
    ...initial.ball,
    position: { xM: start.xM + dx * .4, yM: 34 },
    heightM: BALL_RADIUS_M,
    velocity: { xMps: 0, yMps: 0, zMps: 0 },
    controllerId: striker.playerId,
    controlOffset: { xM: dx * .4, yM: 0 },
    lastTouchPlayerId: striker.playerId,
    outsidePitch: false,
  }
  const command = {
    commandId: 'ai-' + kind + '-test-' + side,
    type: 'attemptKick' as const, teamId: striker.clubId,
    playerId: striker.playerId,
    requestedTick: 20, targetTick: 21, appliedTick: 21, sequence: 1,
    power: kind === 'shot' ? .83 : .51, lift: .06,
    target: { xM: dx === 1 ? setup.pitch.lengthM : 0, yM: 34 },
  }
  const attempted: MatchState = {
    ...initial, kickoff: null,
    clock: { ...initial.clock, tick: 21 },
    players, ball, appliedCommands: [command],
    ai: { ...initial.ai, enabledTeams: [true, true] },
  }
  const kicked = resolveContactAttempts(attempted, setup)
  expect(kicked.contactEvents.at(-1)?.outcome).toBe('kicked')
  expect(kicked.ball.controllerId).toBeNull()
  const next: MatchState = {
    ...kicked,
    clock: { ...kicked.clock, tick: 22 },
    ball: advanceBallPhysics(kicked.ball, setup.pitch),
  }
  return { setup, kicked, next, kicker, defender, dx, start }
}

describe('BOX-F1 physical separation after a foot kick', () => {
  for (const side of [0, 1] as const) {
    for (const kind of ['shot', 'pass'] as const) {
      it(`does not let a kicker intercept their own outgoing ${kind} on side ${side}`, () => {
        const a = actualKick(side, kind)
        expect(outgoingKickStillSeparating(
          a.kicked, a.next, a.kicker)).toBe(true)
        const result = resolveAutomaticBallContact(
          a.kicked, a.next, a.setup)
        expect(result.automaticContactEvents).toHaveLength(0)
        expect(result.ball.lastTouchPlayerId).toBe(a.kicker.playerId)
        expect(result.ball.controllerId).toBeNull()
        expect(result.ball.velocity.xMps * a.dx).toBeGreaterThan(0)
        expect(result.ball).toEqual(a.next.ball)
      })
    }

    it(`still permits a real defender to block the newly kicked shot on side ${side}`, () => {
      const a = actualKick(side, 'shot', true)
      expect(outgoingKickStillSeparating(
        a.kicked, a.next, a.kicker)).toBe(true)
      const result = resolveAutomaticBallContact(
        a.kicked, a.next, a.setup)
      const event = result.automaticContactEvents.at(-1)
      expect(event?.playerId).toBe(a.defender.playerId)
      expect(event?.kind).toBe('interception')
      expect(['intercepted', 'deflected']).toContain(event?.outcome)
      expect(result.ball.lastTouchPlayerId).toBe(a.defender.playerId)
    })

    it(`allows a genuine returning ball after it has LEFT the kick contact envelope on side ${side}`, () => {
      const a = actualKick(side, 'shot')
      const before: MatchState = {
        ...a.kicked,
        clock: { ...a.kicked.clock, tick: 25 },
        ball: { ...a.kicked.ball,
          position: { xM: a.start.xM + a.dx * 1.75, yM: 34 },
          velocity: { xMps: -a.dx * 15, yMps: 0, zMps: 0 },
        },
      }
      const after: MatchState = {
        ...before,
        clock: { ...before.clock, tick: 26 },
        ball: { ...before.ball,
          position: { xM: a.start.xM + a.dx * .7, yM: 34 },
        },
      }
      expect(outgoingKickStillSeparating(before, after, a.kicker)).toBe(false)
      const resolved = resolveAutomaticBallContact(before, after, a.setup)
      expect(resolved.automaticContactEvents.at(-1)?.playerId)
        .toBe(a.kicker.playerId)
      expect(resolved.automaticContactEvents.at(-1)?.kind)
        .toBe('interception')
      expect(['intercepted', 'deflected'])
        .toContain(resolved.automaticContactEvents.at(-1)?.outcome)
    })
  }

  it('replays the supplied 075BCD15 goalkeeper-comparison seed without immediate shooter self-deflections', () => {
    const session = new MatchViewerSession(0x075BCD15, 'keeper-comparison')
    // The original bug report captured a shot at tick 1047. Changing
    // physical DEFENSIVE tactics can legitimately change WHO shoots WHEN.
    // Preserve the user's actual seed/preset, but assert the post-kick
    // separation RULE against all genuine physical foot releases instead
    // of requiring an obsolete scripted match-history checkpoint.
    for (let i = 0; i < 135; i++) session.advance(8)
    const state = session.state
    expect(state.clock.tick).toBe(1080)
    const kicks = state.contactEvents.filter(e =>
      e.outcome === 'kicked' &&
      (e.commandId.startsWith('ai-shot-') ||
        e.commandId.startsWith('ai-pass-')))
    expect(kicks.length).toBeGreaterThan(0)
    const ownImmediate = state.automaticContactEvents.filter(event =>
      kicks.some(kick => event.playerId === kick.playerId &&
        event.tick > kick.tick && event.tick <= kick.tick + 2))
    expect(ownImmediate).toEqual([])
    // Exact replay from the real, unmodified engine checkpoint.
    const restored = restoreFoundationMatch(session.checkpoint())
    for (let i = 0; i < 14; i++) {
      session.advance(1)
      restored.advance(1)
      expect(restored.checkpoint()).toEqual(session.checkpoint())
    }
  }, 20_000)
})
