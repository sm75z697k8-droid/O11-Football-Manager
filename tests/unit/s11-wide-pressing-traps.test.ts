import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import type { MatchState, PlayerMatchState } from '../../src/game/match/state'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { planDefensiveResponsibilities } from '../../src/game/ai/defensive-shape'
import { projectPlayerToward } from '../../src/game/physics/locomotion'
import { maintainWidePassFlightScreen } from '../../src/game/ai/pressing-traps'

/**
 * Tactical scenes use synthetic POSITIONING only; they never claim a
 * physical tackle or replayed professional match event. Both home/away
 * mirrors must produce the same lane-screen coordination.
 */
function wideScene(side: 0 | 1) {
  const setup = makeFictionalMatchSetup()
  const original = createFoundationMatch(setup).getState()
  const team = original.teams[side]
  const other = original.teams[1 - side]
  const mirror = (xM: number, yM: number) => side === 0
    ? { xM, yM }
    : { xM: setup.pitch.lengthM - xM, yM: setup.pitch.widthM - yM }
  const ball = mirror(60, 5)
  const get = (clubId: string, slot: string) =>
    original.players.find(p => p.clubId === clubId &&
      p.formationSlot === slot)!
  const carrier = get(other.clubId, 'RB')
  const outlet = get(other.clubId, 'DM')
  const presser = get(team.clubId, 'LW')
  const cover = get(team.clubId, 'DM')
  const screener = get(team.clubId, 'LCM')
  const placed = new Map([
    [carrier.playerId, ball],
    [outlet.playerId, mirror(45, 19)],
    [presser.playerId, mirror(55, 5)],
    [cover.playerId, mirror(52, 9)],
    [screener.playerId, mirror(51, 15)],
  ])
  const players = original.players.map(p => ({
    ...p,
    position: placed.get(p.playerId) ??
      (p.clubId === team.clubId
        ? mirror(18, 42) : mirror(93, 51)),
    velocity: { xMps: 0, yMps: 0 },
  }))
  const state: MatchState = {
    ...original, kickoff: null,
    clock: { ...original.clock, tick: 120 },
    players,
    teams: [
      { ...original.teams[0],
        pressingIntensity: side === 0 ? 'standard' : original.teams[0].pressingIntensity },
      { ...original.teams[1],
        pressingIntensity: side === 1 ? 'standard' : original.teams[1].pressingIntensity },
    ],
    ball: {
      ...original.ball, controllerId: carrier.playerId,
      lastTouchPlayerId: carrier.playerId, position: ball,
      controlOffset: { xM: 0, yM: 0 },
      heightM: .11, outsidePitch: false,
      velocity: { xMps: 0, yMps: 0, zMps: 0 },
    },
    ai: { ...original.ai, enabledTeams: [true, true], decisionSnapshot: [] },
  }
  return { setup, state, team, ball, presser, cover, screener,
    outlet, mirror }
}

function assignment(state: MatchState, player: PlayerMatchState) {
  const decision = state.ai.decisionSnapshot.find(d => d.playerId === player.playerId)
  return decision
}

describe('S1.1 — physical, outlet-aware wide pressing coordination', () => {
  for (const side of [0, 1] as const) {
    it(`coordinates presser, distinct cover and real passing-lane screener on side ${side}`, () => {
      const scene = wideScene(side)
      const { setup, state, team, ball, presser, cover, screener, outlet } = scene
      const plan = planDefensiveResponsibilities(state, setup, team, ball)
      const first = plan.get(presser.playerId)!
      const second = plan.get(screener.playerId)!
      expect(first.action).toBe('press')
      expect(first.engage).toBe(true)
      expect(plan.get(cover.playerId)?.action).toBe('cover')
      expect(second.action).toBe('screen')
      expect(second.engage).toBe(false)
      const inside = side === 0 ? 1 : -1
      expect((first.target.yM - ball.yM) * inside).toBeGreaterThan(1)
      // The screen is ON the real player-to-player passing segment.
      const receiver = state.players.find(p => p.playerId === outlet.playerId)!
      const vx = receiver.position.xM - ball.xM
      const vy = receiver.position.yM - ball.yM
      const ux = second.target.xM - ball.xM
      const uy = second.target.yM - ball.yM
      const perpendicularGap = Math.abs(vx * uy - vy * ux) /
        Math.hypot(vx, vy)
      expect(perpendicularGap).toBeLessThan(1e-6)
      expect(Math.hypot(ux, uy)).toBeGreaterThan(4)

      // The shared team planner must preserve these assignments and the
      // real movement integrator must move gradually, never teleport.
      const decisions = planTeamDecisions(state, setup)
      expect(decisions.find(d => d.playerId === presser.playerId)?.target)
        .toEqual(first.target)
      expect(decisions.find(d => d.playerId === screener.playerId)?.target)
        .toEqual(second.target)
      const player = state.players.find(p => p.playerId === screener.playerId)!
      const def = setup.players.find(p => p.id === screener.playerId)!
      const next = projectPlayerToward(player, def, second.target,
        setup.pitch, state.clock.tick + 1)
      expect(Math.hypot(next.position.xM - player.position.xM,
        next.position.yM - player.position.yM)).toBeLessThan(.35)
      expect(state.automaticContactEvents).toHaveLength(0)
      expect(state.goalEvents).toHaveLength(0)
      expect(assignment(state, screener)).toBeUndefined()
    })

    it(`allows a genuine kicked pass to be physically intercepted on side ${side}`, () => {
      const scene = wideScene(side)
      const prepared = planTeamDecisions(scene.state, scene.setup)
      const staged = prepared.find(d => d.playerId === scene.screener.playerId)!
      expect(staged.action).toBe('screen')
      expect(staged.engage).toBe(false) // no phantom tackle while owned

      const velocity = side === 0
        ? { xMps: -10, yMps: 9.33, zMps: 0 }
        : { xMps: 10, yMps: -9.33, zMps: 0 }
      const carrierId = scene.state.ball.controllerId!
      const inFlight: MatchState = {
        ...scene.state,
        clock: { ...scene.state.clock, tick: 126 },
        ball: {
          ...scene.state.ball, controllerId: null, controlOffset: null,
          position: scene.mirror(58, 7), velocity,
        },
        ai: { ...scene.state.ai, decisionSnapshot: prepared },
        contactEvents: [{
          commandId: 'synthetic-physical-kick-fixture',
          playerId: carrierId, kind: 'kick', outcome: 'kicked',
          tick: 125, drawUsed: 1,
        }],
      }
      const retained = maintainWidePassFlightScreen(inFlight, scene.team)
      expect(retained?.screenerId).toBe(scene.screener.playerId)
      expect(retained?.screenTarget).toEqual(staged.target)
      const defended = planDefensiveResponsibilities(
        inFlight, scene.setup, scene.team, inFlight.ball.position)
      expect(defended.get(scene.screener.playerId)?.action).toBe('screen')
      expect(defended.get(scene.screener.playerId)?.engage).toBe(true)
      // Even if the loose-ball predictor nominates this defender to
      // recover, the team planner must retain genuine contact eligibility.
      const decisions = planTeamDecisions(inFlight, scene.setup)
      expect(decisions.find(d => d.playerId === scene.screener.playerId)
        ?.engage).toBe(true)
      expect(inFlight.automaticContactEvents).toHaveLength(0)

      // A ball travelling AWAY from the previous lane cannot inherit
      // a phantom interception opportunity.
      const away: MatchState = {
        ...inFlight, ball: {
          ...inFlight.ball, velocity: {
            xMps: -velocity.xMps, yMps: -velocity.yMps, zMps: 0,
          },
        },
      }
      expect(maintainWidePassFlightScreen(away, scene.team)).toBeNull()
    })

    it(`does not fabricate a lane screen with no nearby inside outlet on side ${side}`, () => {
      const scene = wideScene(side)
      const state: MatchState = {
        ...scene.state,
        players: scene.state.players.map(p =>
          p.playerId === scene.outlet.playerId
            ? { ...p, position: scene.mirror(93, 51) } : p),
      }
      const plan = planDefensiveResponsibilities(
        state, scene.setup, scene.team, scene.ball)
      expect(plan.get(scene.screener.playerId)?.action).not.toBe('screen')
      expect(plan.get(scene.presser.playerId)?.action).toBe('press')
    })

    it(`rejects an unreachable lane screener instead of pulling shape apart on side ${side}`, () => {
      const scene = wideScene(side)
      const state: MatchState = {
        ...scene.state,
        players: scene.state.players.map(p =>
          p.playerId === scene.screener.playerId
            ? { ...p, position: scene.mirror(18, 42) } : p),
      }
      const plan = planDefensiveResponsibilities(
        state, scene.setup, scene.team, scene.ball)
      expect(plan.get(scene.screener.playerId)?.action).not.toBe('screen')
      expect(plan.get(scene.cover.playerId)?.action).toBe('cover')
    })

    it(`keeps the ordinary press when the carrier is no longer wide on side ${side}`, () => {
      const scene = wideScene(side)
      const moved = scene.mirror(60, 34)
      const state: MatchState = {
        ...scene.state, ball: { ...scene.state.ball, position: moved },
        players: scene.state.players.map(p =>
          p.playerId === scene.presser.playerId
            ? { ...p, position: scene.mirror(55, 34) }
            : p.playerId === scene.state.ball.controllerId
              ? { ...p, position: moved } : p),
      }
      const plan = planDefensiveResponsibilities(
        state, scene.setup, scene.team, moved)
      const first = plan.get(scene.presser.playerId)!
      expect(first.action).not.toBe('screen')
      expect(plan.get(scene.screener.playerId)?.target)
        .not.toEqual(plan.get(scene.presser.playerId)?.target)
    })
  }
})
