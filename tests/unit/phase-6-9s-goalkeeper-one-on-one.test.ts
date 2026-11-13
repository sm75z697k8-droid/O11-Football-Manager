import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import {
  planGoalkeeperOneOnOne, trackGoalkeeperOneOnOnes,
} from '../../src/game/ai/goalkeeper-one-on-one'
import { resolveAutomaticBallContact } from '../../src/game/physics/automatic-contact'
import { activeGoalkeeperCatch } from '../../src/game/physics/goalkeeper-handling'
import type { MatchSetup } from '../../src/game/model/match'
import type { MatchState } from '../../src/game/match/state'

interface Options {
  side?: 0 | 1
  depth?: number
  lateral?: number
  towardsGoalMps?: number
  cover?: boolean
  goalieDepth?: number
  goalieQuality?: number
  controller?: boolean
  highBall?: boolean
}
function scenario(options: Options = {}) {
  const setupOriginal = makeFictionalMatchSetup()
  const original = createFoundationMatch(setupOriginal).getState()
  const side = options.side ?? 0
  const team = original.teams[side]
  const ownGoal = team.attackingDirection === 1 ? 0 : setupOriginal.pitch.lengthM
  const keeper = original.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'GK')!
  const carrier = original.players.find(p =>
    p.clubId !== team.clubId && p.formationSlot === 'ST')!
  const coverer = original.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'RCB')!
  const dir = team.attackingDirection
  const depth = options.depth ?? 12
  const lateral = options.lateral ?? 1.5
  const carrierPosition = {
    xM: ownGoal + dir * depth,
    yM: setupOriginal.pitch.widthM / 2 + lateral,
  }
  const keeperPosition = {
    xM: ownGoal + dir * (options.goalieDepth ?? 4.5),
    yM: setupOriginal.pitch.widthM / 2,
  }
  const players = original.players.map(p => {
    if (p.playerId === keeper.playerId) {
      return {
        ...p, position: keeperPosition, engagesBall: false,
        velocity: { xMps: 0, yMps: 0 },
      }
    }
    if (p.playerId === carrier.playerId) {
      return { ...p, position: carrierPosition,
        velocity: { xMps: -dir * (options.towardsGoalMps ?? 3), yMps: 0 },
      }
    }
    if (options.cover && p.playerId === coverer.playerId) {
      return { ...p, position: {
        xM: carrierPosition.xM - dir * 2, yM: carrierPosition.yM + 1,
      } }
    }
    if (p.clubId === team.clubId && p.formationSlot !== 'GK') {
      return { ...p, position: {
        xM: ownGoal + dir * 33, yM: p.position.yM,
      } }
    }
    return p
  })
  const setup: MatchSetup = options.goalieQuality === undefined
    ? setupOriginal : {
      ...setupOriginal,
      players: setupOriginal.players.map(p => p.id !== keeper.playerId ||
        !p.abilities.goalkeeping ? p : {
          ...p, abilities: {
            ...p.abilities, goalkeeping: {
              ...p.abilities.goalkeeping,
              oneOnOnes: options.goalieQuality!,
              rushingOut: options.goalieQuality!,
              handling: options.goalieQuality!,
            },
          },
        }),
    }
  const state: MatchState = {
    ...original, kickoff: null,
    clock: { ...original.clock, tick: 120 },
    players,
    ai: {
      ...original.ai,
      enabledTeams: [true, true],
      lastDecisionTick: 108,
    },
    ball: {
      ...original.ball, position: {
        xM: carrierPosition.xM - dir * .2,
        yM: carrierPosition.yM,
      },
      heightM: options.highBall ? 1.2 : .11,
      velocity: { xMps: -dir * 3, yMps: 0, zMps: 0 },
      controllerId: options.controller === false ? null : carrier.playerId,
      controlOffset: options.controller === false ? null :
        { xM: -dir * .2, yM: 0 },
      lastTouchPlayerId: carrier.playerId,
      outsidePitch: false,
    },
  }
  return { setup, state, team, keeper: players.find(p =>
    p.playerId === keeper.playerId)!, carrier, coverer, dir }
}

describe('Phase 6.9S goalkeeper one-on-one intelligence', () => {
  it('closes a dangerous central dribbler on either side, without engaging too early', () => {
    for (const side of [0, 1] as const) {
      const { setup, state, keeper, team } = scenario({ side })
      const original = JSON.stringify(state)
      const intent = planGoalkeeperOneOnOne(state, setup, keeper, team)
      expect(intent?.mode).toBe('close')
      expect(intent?.engage).toBe(false)
      const goalX = side === 0 ? 0 : setup.pitch.lengthM
      const depth = (intent!.target.xM - goalX) * team.attackingDirection
      expect(depth).toBeGreaterThan(4.5)
      expect(depth).toBeLessThan(11.5)
      expect(intent!.target.yM).toBeGreaterThan(34)
      expect(JSON.stringify(state)).toBe(original)
    }
  })

  it('defers to the covering defender instead of blindly charging', () => {
    const { state, setup, keeper, team } = scenario({ cover: true })
    expect(planGoalkeeperOneOnOne(state, setup, keeper, team)).toBeNull()
    const keeperDecision = planTeamDecisions(state, setup).find(d =>
      d.playerId === keeper.playerId)!
    expect(keeperDecision.action).toBe('shape')
    expect(keeperDecision.engage).toBe(false)
  })

  it('holds line on remote, stationary or wide possession and never chases a teammate', () => {
    const stationary = scenario({ depth: 20, towardsGoalMps: 0 })
    expect(planGoalkeeperOneOnOne(stationary.state, stationary.setup,
      stationary.keeper, stationary.team)).toBeNull()
    const wide = scenario({ depth: 9, lateral: 19 })
    expect(planGoalkeeperOneOnOne(wide.state, wide.setup,
      wide.keeper, wide.team)).toBeNull()
    const uncontrolled = scenario({ controller: false })
    expect(planGoalkeeperOneOnOne(uncontrolled.state, uncontrolled.setup,
      uncontrolled.keeper, uncontrolled.team)).toBeNull()
    const airborne = scenario({ highBall: true })
    expect(planGoalkeeperOneOnOne(airborne.state, airborne.setup,
      airborne.keeper, airborne.team)).toBeNull()
    const friendly = scenario()
    const ball = {
      ...friendly.state.ball,
      controllerId: friendly.keeper.playerId,
    }
    expect(planGoalkeeperOneOnOne({
      ...friendly.state, ball,
    }, friendly.setup, friendly.keeper, friendly.team)).toBeNull()
  })

  it('uses keeper ability to judge a safe closing depth', () => {
    const poor = scenario({ goalieQuality: 12 })
    const elite = scenario({ goalieQuality: 98 })
    const a = planGoalkeeperOneOnOne(poor.state, poor.setup,
      poor.keeper, poor.team)!.target
    const b = planGoalkeeperOneOnOne(elite.state, elite.setup,
      elite.keeper, elite.team)!.target
    expect(b.xM).toBeGreaterThan(a.xM)
    expect(b.xM).toBeLessThan(12)
  })

  it('updates 1v1 movement on a physics tick without changing the other 21 players', () => {
    const scene = scenario({ depth: 10 })
    const decisions = planTeamDecisions(scene.state, scene.setup)
    const current = {
      ...scene.state,
      ai: { ...scene.state.ai, decisionSnapshot: decisions },
    }
    const updated = trackGoalkeeperOneOnOnes(current, scene.setup)
    const newKeeper = updated.players.find(p =>
      p.playerId === scene.keeper.playerId)!
    expect(newKeeper.intention.kind).toBe('moveToPoint')
    expect(newKeeper.engagesBall).toBe(false)
    expect(updated.ai.decisionSnapshot.find(d =>
      d.playerId === scene.keeper.playerId)?.action).toBe('oneOnOne')
    for (const previous of scene.state.players) {
      if (previous.playerId === scene.keeper.playerId) continue
      expect(updated.players.find(p => p.playerId === previous.playerId))
        .toEqual(previous)
    }
    expect(updated.ball).toEqual(scene.state.ball)
    expect(updated.contactEvents).toEqual(scene.state.contactEvents)
  })

  it('permits a real in-area hand smother only after the keeper reaches the dribbled ball', () => {
    for (const side of [0, 1] as const) {
      const scene = scenario({
        side, depth: 5.6, lateral: 0, goalieDepth: 4.5,
        goalieQuality: 99, towardsGoalMps: 1.5,
      })
      const players = scene.state.players.map(p =>
        p.playerId === scene.keeper.playerId
          ? { ...p, engagesBall: true } : { ...p, engagesBall: false })
      const before: MatchState = {
        ...scene.state,
        players,
        ball: {
          ...scene.state.ball,
          velocity: { xMps: -scene.dir * 1.5, yMps: 0, zMps: 0 },
        },
      }
      const after: MatchState = {
        ...before,
        clock: { ...before.clock, tick: 121 },
        ball: {
          ...before.ball,
          position: {
            xM: before.ball.position.xM - scene.dir * .1,
            yM: before.ball.position.yM,
          },
        },
      }
      const result = resolveAutomaticBallContact(before, after, scene.setup)
      const contact = result.automaticContactEvents.at(-1)
      expect(contact?.outcome).toBe('caught')
      expect(contact?.kind).toBe('challenge')
      expect(contact?.playerId).toBe(scene.keeper.playerId)
      expect(result.ball.controllerId).toBe(scene.keeper.playerId)
      expect(activeGoalkeeperCatch(result)?.tick).toBe(121)
      expect(result.ball.lastTouchPlayerId).toBe(scene.keeper.playerId)
    }
  })

  it('leaves possession with a capable dribbler after a physically failed smother', () => {
    const scene = scenario({
      depth: 5.6, lateral: 0, goalieDepth: 4.5,
      goalieQuality: 5, towardsGoalMps: 1.5,
    })
    const players = scene.state.players.map(p =>
      p.playerId === scene.keeper.playerId
        ? { ...p, engagesBall: true } : { ...p, engagesBall: false })
    const before: MatchState = {
      ...scene.state, players,
    }
    const after: MatchState = {
      ...before, clock: { ...before.clock, tick: 121 },
    }
    const failed = resolveAutomaticBallContact(before, after, scene.setup)
    expect(failed.automaticContactEvents.at(-1)?.outcome).toBe('heldOff')
    expect(failed.ball.controllerId).toBe(scene.carrier.playerId)
    expect(activeGoalkeeperCatch(failed)).toBeNull()
    expect(failed.ball.position).toEqual(after.ball.position)
  })

  it('never turns a shot into a dribbler smother or overrides reflex saving', () => {
    const scene = scenario({ depth: 12, lateral: 0 })
    const shot: MatchState = {
      ...scene.state,
      ball: {
        ...scene.state.ball,
        controllerId: null, controlOffset: null,
        velocity: { xMps: -scene.dir * 25, yMps: 0, zMps: 0 },
      },
      contactEvents: [{
        commandId: 'ai-shot-one-on-one-test',
        playerId: scene.carrier.playerId,
        tick: 117, kind: 'kick', outcome: 'kicked', drawUsed: 1,
      }],
    }
    expect(planGoalkeeperOneOnOne(shot, scene.setup, scene.keeper, scene.team))
      .toBeNull()
    const decision = planTeamDecisions(shot, scene.setup).find(d =>
      d.playerId === scene.keeper.playerId)!
    expect(decision.action).toBe('save')
    expect(decision.engage).toBe(true)
  })

  it('retains deterministic physical replay in actual seeded match sessions', () => {
    const setup = makeFictionalMatchSetup()
    const first = createFoundationMatch(setup)
    const second = createFoundationMatch(setup)
    for (const club of setup.clubs) {
      const command = {
        type: 'setAutonomousTeam' as const,
        teamId: club.id, enabled: true,
        commandId: 'one-on-one-replay-' + club.id,
      }
      expect(first.submitCommand(command).accepted).toBe(true)
      expect(second.submitCommand(command).accepted).toBe(true)
    }
    first.advance(360)
    second.advance(360)
    expect(second.checkpoint()).toEqual(first.checkpoint())
    expect(restoreFoundationMatch(first.checkpoint()).checkpoint())
      .toEqual(first.checkpoint())
  })
})
