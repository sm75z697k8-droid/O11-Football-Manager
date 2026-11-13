import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import {
  activeAerialDelivery, goalkeeperCrossHandReach,
  planGoalkeeperAerial, trackGoalkeeperAerials,
} from '../../src/game/ai/goalkeeper-aerial'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { resolveAutomaticBallContact } from '../../src/game/physics/automatic-contact'
import { activeGoalkeeperCatch, GOALKEEPER_HAND_HEIGHT_M } from '../../src/game/physics/goalkeeper-handling'
import type { MatchState } from '../../src/game/match/state'
import type { MatchSetup } from '../../src/game/model/match'

interface Options {
  side?: 0 | 1
  lift?: number
  crossClaiming?: number
  handling?: number
  commandOfArea?: number
  punching?: number
  crowded?: boolean
  kickerWide?: boolean
}

function scenario(options: Options = {}) {
  const base = makeFictionalMatchSetup()
  const original = createFoundationMatch(base).getState()
  const side = options.side ?? 0
  const team = original.teams[side]
  const direction = team.attackingDirection
  const goalX = side === 0 ? 0 : base.pitch.lengthM
  const keeper = original.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'GK')!
  const kicker = original.players.find(p =>
    p.clubId !== team.clubId && p.formationSlot === 'RW')!
  const opponent = original.players.find(p =>
    p.clubId !== team.clubId && p.formationSlot === 'ST')!
  const goalCentreY = base.pitch.widthM / 2
  const kickerPosition = {
    xM: goalX + direction * 22,
    yM: options.kickerWide === false ? goalCentreY : 14,
  }
  const destination = {
    xM: goalX + direction * 5.5,
    yM: goalCentreY,
  }
  const goalkeeperPosition = {
    xM: goalX + direction * 5.5,
    yM: 33,
  }
  const setup: MatchSetup = {
    ...base,
    players: base.players.map(p => {
      if (p.id !== keeper.playerId || !p.abilities.goalkeeping) return p
      return {
        ...p,
        abilities: {
          ...p.abilities,
          goalkeeping: {
            ...p.abilities.goalkeeping,
            crossClaiming: options.crossClaiming ??
              p.abilities.goalkeeping.crossClaiming,
            handling: options.handling ??
              p.abilities.goalkeeping.handling,
            commandOfArea: options.commandOfArea ??
              p.abilities.goalkeeping.commandOfArea,
            punching: options.punching ??
              p.abilities.goalkeeping.punching,
          },
        },
      }
    }),
  }
  const players = original.players.map(p => {
    if (p.playerId === keeper.playerId)
      return { ...p, position: goalkeeperPosition,
        velocity: { xMps: 0, yMps: 0 }, engagesBall: true }
    if (p.playerId === kicker.playerId) return {
      ...p, position: kickerPosition, engagesBall: false,
    }
    if (p.playerId === opponent.playerId) return {
      ...p, position: { xM: goalX + direction * 7.5,
        yM: options.crowded ? 34.2 : 49 },
      engagesBall: false,
    }
    return { ...p, engagesBall: false,
      position: { xM: goalX + direction * 35, yM: p.position.yM } }
  })
  const command = {
    commandId: 'ai-pass-99-wide-cross',
    playerId: kicker.playerId,
    teamId: kicker.clubId,
    type: 'attemptKick' as const,
    target: destination,
    power: .76,
    lift: options.lift ?? .58,
    requestedTick: 98,
    targetTick: 99,
    appliedTick: 99,
    sequence: 1,
  }
  const originalState: MatchState = {
    ...original, kickoff: null,
    clock: { ...original.clock, tick: 101 },
    players, ai: {
      ...original.ai, enabledTeams: [true, true],
      lastDecisionTick: 96,
    },
    ball: {
      ...original.ball,
      controllerId: null, controlOffset: null,
      lastTouchPlayerId: kicker.playerId,
      position: { xM: goalX + direction * 12, yM: 26 },
      heightM: 1.35,
      velocity: { xMps: -direction * 12, yMps: 11, zMps: 3.5 },
      outsidePitch: false,
    },
    appliedCommands: [command],
    contactEvents: [{
      commandId: command.commandId,
      playerId: kicker.playerId, tick: 99,
      kind: 'kick', outcome: 'kicked', drawUsed: 1,
    }],
  }
  return { setup, state: originalState, team, keeper: players.find(p =>
    p.playerId === keeper.playerId)!, kicker, goalX, direction }
}

describe('Phase 6.9T goalkeeper aerial deliveries', () => {
  it('recognizes actual lofted wide kicks towards either penalty area', () => {
    for (const side of [0, 1] as const) {
      const scene = scenario({ side })
      const kick = activeAerialDelivery(scene.state, scene.setup, scene.team)
      expect(kick?.kickerId).toBe(scene.kicker.playerId)
      expect(kick?.lift).toBeCloseTo(.58)
    }
  })

  it('refuses low passes, centrally played balls, diagnostic flights and retouched balls', () => {
    const low = scenario({ lift: .08 })
    expect(activeAerialDelivery(low.state, low.setup, low.team)).toBeNull()
    const central = scenario({ kickerWide: false })
    expect(activeAerialDelivery(central.state, central.setup, central.team)).toBeNull()
    const scene = scenario()
    expect(activeAerialDelivery({
      ...scene.state, contactEvents: [],
    }, scene.setup, scene.team)).toBeNull()
    expect(activeAerialDelivery({
      ...scene.state, ball: { ...scene.state.ball, lastTouchPlayerId: null },
    }, scene.setup, scene.team)).toBeNull()
    expect(activeAerialDelivery({
      ...scene.state, ball: {
        ...scene.state.ball, heightM: .11,
        velocity: { ...scene.state.ball.velocity, zMps: 0 },
      },
    }, scene.setup, scene.team)).toBeNull()
    const shot = {
      ...scene.state,
      contactEvents: scene.state.contactEvents.map(e => ({
        ...e, commandId: 'ai-shot-99-real',
      })),
    }
    expect(activeAerialDelivery(shot, scene.setup, scene.team)).toBeNull()
  })

  it('projects the real aerial path and makes an in-box keeper engage without moving the ball', () => {
    for (const side of [0, 1] as const) {
      const scene = scenario({ side })
      const baseline = JSON.stringify(scene.state)
      const choice = planGoalkeeperAerial(
        scene.state, scene.setup, scene.keeper, scene.team)
      expect(choice?.mode).toBe('claim')
      expect(choice?.engage).toBe(true)
      expect(choice!.impactSeconds).toBeGreaterThan(0)
      expect(choice!.target.xM).toBeGreaterThanOrEqual(0)
      expect(choice!.target.xM).toBeLessThanOrEqual(scene.setup.pitch.lengthM)
      const planned = planTeamDecisions(scene.state, scene.setup)
      const keeper = planned.find(p => p.playerId === scene.keeper.playerId)!
      expect(keeper.action).toBe('claimCross')
      expect(keeper.engage).toBe(true)
      expect(JSON.stringify(scene.state)).toBe(baseline)
    }
  })

  it('tracks a keeper on every physical tick while leaving every outfielder untouched', () => {
    const scene = scenario()
    const before = scene.state
    const changed = trackGoalkeeperAerials(before, scene.setup)
    const keeper = changed.players.find(p => p.playerId === scene.keeper.playerId)!
    expect(keeper.intention.kind).toBe('moveToPoint')
    expect(keeper.engagesBall).toBe(true)
    for (const outfielder of before.players) {
      if (outfielder.playerId === keeper.playerId) continue
      expect(changed.players.find(p => p.playerId === outfielder.playerId))
        .toEqual(outfielder)
    }
    expect(changed.ball).toEqual(before.ball)
    expect(changed.contactEvents).toEqual(before.contactEvents)
  })

  it('keeps goalkeeper cross reach finite, height gated and attribute-driven', () => {
    const skilled = scenario({ crossClaiming: 95 })
    const weak = scenario({ crossClaiming: 10 })
    const strongDef = skilled.setup.players.find(p =>
      p.id === skilled.keeper.playerId)!
    const weakDef = weak.setup.players.find(p =>
      p.id === weak.keeper.playerId)!
    const a = goalkeeperCrossHandReach(strongDef)
    const b = goalkeeperCrossHandReach(weakDef)
    expect(a.horizontalM).toBeGreaterThan(b.horizontalM)
    expect(a.maximumHeightM).toBeGreaterThan(b.maximumHeightM)
    expect(a.maximumHeightM).toBeLessThan(2.5)
  })

  it('catches an uncontested moderate-speed ball only through a real swept intersection', () => {
    for (const side of [0, 1] as const) {
      const scene = scenario({ side, crossClaiming: 95, handling: 97 })
      const before: MatchState = {
        ...scene.state,
        ball: {
          ...scene.state.ball,
          position: { xM: scene.goalX + scene.direction * 6.3, yM: 33.6 },
          heightM: 1.6, velocity: {
            xMps: -scene.direction * 8, yMps: 0, zMps: -1,
          },
        },
      }
      const after: MatchState = {
        ...before,
        clock: { ...before.clock, tick: 102 },
        ball: {
          ...before.ball,
          position: { xM: scene.goalX + scene.direction * 5.9, yM: 33.6 },
          heightM: 1.55,
        },
      }
      const result = resolveAutomaticBallContact(before, after, scene.setup)
      expect(result.automaticContactEvents.at(-1)?.outcome).toBe('caught')
      expect(result.automaticContactEvents.at(-1)?.kind).toBe('interception')
      expect(result.ball.controllerId).toBe(scene.keeper.playerId)
      expect(result.ball.heightM).toBe(GOALKEEPER_HAND_HEIGHT_M)
      expect(activeGoalkeeperCatch(result)?.tick).toBe(102)
    }
  })

  it('punched contact gives an actual outward ball impulse under crowd pressure', () => {
    for (const side of [0, 1] as const) {
      const scene = scenario({
        side, crossClaiming: 30, handling: 25, commandOfArea: 30,
        punching: 90, crowded: true,
      })
      const before: MatchState = {
        ...scene.state,
        ball: {
          ...scene.state.ball,
          position: { xM: scene.goalX + scene.direction * 6.2, yM: 33.5 },
          heightM: 1.9,
          velocity: { xMps: -scene.direction * 21, yMps: 0, zMps: -1 },
        },
      }
      const after: MatchState = {
        ...before,
        clock: { ...before.clock, tick: 102 },
        ball: {
          ...before.ball,
          position: { xM: scene.goalX + scene.direction * 5.15, yM: 33.5 },
          heightM: 1.85,
        },
      }
      const result = resolveAutomaticBallContact(before, after, scene.setup)
      expect(result.automaticContactEvents.at(-1)?.outcome).toBe('punched')
      expect(result.automaticContactEvents.at(-1)?.playerId).toBe(scene.keeper.playerId)
      expect(result.ball.controllerId).toBeNull()
      expect(result.ball.lastTouchPlayerId).toBe(scene.keeper.playerId)
      expect(result.ball.velocity.xMps * scene.direction).toBeGreaterThan(0)
      expect(result.ball.velocity.zMps).toBeGreaterThan(0)
    }
  })

  it('does not award a catch/punch when the incoming cross misses the GK envelope', () => {
    const scene = scenario()
    const before = {
      ...scene.state, ball: {
        ...scene.state.ball, position: { xM: 10, yM: 35 },
        heightM: 3.2,
      },
    }
    const after = {
      ...before, clock: { ...before.clock, tick: 102 },
      ball: {
        ...before.ball, position: { xM: 9.4, yM: 35 },
        heightM: 3.1,
      },
    }
    expect(resolveAutomaticBallContact(before, after, scene.setup)
      .automaticContactEvents).toHaveLength(0)
  })

  it('keeps deterministic match replay intact alongside previous save/distribution behavior', () => {
    const setup = makeFictionalMatchSetup()
    const first = createFoundationMatch(setup)
    for (const club of setup.clubs) {
      expect(first.submitCommand({
        commandId: 'aerial-phase-enable-' + club.id,
        teamId: club.id, type: 'setAutonomousTeam', enabled: true,
      }).accepted).toBe(true)
    }
    first.advance(300)
    expect(restoreFoundationMatch(first.checkpoint()).checkpoint())
      .toEqual(first.checkpoint())
  })
})
