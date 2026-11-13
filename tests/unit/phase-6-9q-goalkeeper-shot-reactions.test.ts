import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { planGoalkeeperSave } from '../../src/game/ai/goal-directed'
import { resolveAutomaticBallContact } from '../../src/game/physics/automatic-contact'
import { goalkeeperSaveWindow } from '../../src/game/physics/goalkeeper-saves'
import type { MatchSetup } from '../../src/game/model/match'
import type { MatchState } from '../../src/game/match/state'

interface SceneOptions {
  side?: 0 | 1
  ageTicks?: number
  lateralM?: number
  heightM?: number
  speedMps?: number
  handling?: number
  reflexes?: number
  diving?: number
  parrying?: number
  claiming?: number
}

function stage(options: SceneOptions = {}) {
  const side = options.side ?? 0
  const base = makeFictionalMatchSetup()
  const source = createFoundationMatch(base).getState()
  const team = source.teams[side]
  const keeper = source.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'GK')!
  const shooter = source.players.find(p =>
    p.clubId !== team.clubId && p.formationSlot === 'ST')!
  const direction = team.attackingDirection
  const keeperX = side === 0 ? 4.7 : base.pitch.lengthM - 4.7
  const keeperY = base.pitch.widthM / 2
  const age = options.ageTicks ?? 2
  const speed = options.speedMps ?? 8
  const height = options.heightM ?? 1
  const lateral = options.lateralM ?? 0
  const players = source.players.map(p => p.playerId === keeper.playerId
    ? { ...p, position: { xM: keeperX, yM: keeperY },
      velocity: { xMps: 0, yMps: 0 }, engagesBall: true }
    : { ...p, engagesBall: false })
  const setup: MatchSetup = {
    ...base,
    players: base.players.map(p => {
      if (p.id !== keeper.playerId || !p.abilities.goalkeeping) return p
      const gk = p.abilities.goalkeeping
      return {
        ...p, abilities: {
          ...p.abilities, goalkeeping: {
            ...gk,
            handling: options.handling ?? gk.handling,
            reflexes: options.reflexes ?? gk.reflexes,
            diving: options.diving ?? gk.diving,
            parrying: options.parrying ?? gk.parrying,
            crossClaiming: options.claiming ?? gk.crossClaiming,
          },
        },
      }
    }),
  }
  const state: MatchState = {
    ...source,
    kickoff: null,
    clock: { ...source.clock, tick: 49 },
    players,
    ai: { ...source.ai, enabledTeams: [true, true] },
    ball: {
      ...source.ball, heightM: height,
      position: {
        xM: keeperX + direction * .7, yM: keeperY + lateral,
      },
      velocity: { xMps: -direction * speed, yMps: 0, zMps: 0 },
      controllerId: null, controlOffset: null,
      lastTouchPlayerId: shooter.playerId, outsidePitch: false,
    },
    contactEvents: [{
      commandId: 'ai-shot-save-reach-test', playerId: shooter.playerId,
      kind: 'kick', outcome: 'kicked', tick: 50 - age, drawUsed: 1,
    }],
  }
  const after: MatchState = {
    ...state,
    clock: { ...state.clock, tick: 50 },
    ball: {
      ...state.ball, position: {
        xM: keeperX + direction * .45,
        yM: keeperY + lateral,
      },
    },
  }
  return { setup, before: state, after, keeper: players.find(p =>
    p.playerId === keeper.playerId)!, shooter, team }
}

describe('Phase 6.9Q physical goalkeeper shot reactions and saves', () => {
  it('uses goalkeeper attributes to control reaction delay and dive reach', () => {
    const low = stage({ reflexes: 15, diving: 15 })
    const elite = stage({ reflexes: 95, diving: 95 })
    const a = low.setup.players.find(p => p.id === low.keeper.playerId)!
    const b = elite.setup.players.find(p => p.id === elite.keeper.playerId)!
    const earlyA = goalkeeperSaveWindow(a, 52, 50)
    const earlyB = goalkeeperSaveWindow(b, 52, 50)
    expect(earlyA.reacted).toBe(false)
    expect(earlyB.reacted).toBe(false)
    expect(earlyA.reachM).toBeCloseTo(.82)
    expect(earlyB.reachM).toBeCloseTo(.82)
    expect(earlyB.reactionDelaySeconds)
      .toBeLessThan(earlyA.reactionDelaySeconds)
    const lateA = goalkeeperSaveWindow(a, 70, 50)
    const lateB = goalkeeperSaveWindow(b, 70, 50)
    expect(lateA.reacted).toBe(true)
    expect(lateB.reacted).toBe(true)
    expect(lateB.reachM).toBeGreaterThan(lateA.reachM)
    expect(lateB.maximumHeightM).toBeGreaterThan(2.1)
  })

  it('does not allow instant full-extension saves at either goal', () => {
    for (const side of [0, 1] as const) {
      const scene = stage({ side, lateralM: 1.2, ageTicks: 2 })
      const before = JSON.stringify(scene.after)
      const result = resolveAutomaticBallContact(
        scene.before, scene.after, scene.setup)
      expect(result.automaticContactEvents).toHaveLength(0)
      expect(result.ball.controllerId).toBeNull()
      expect(JSON.stringify(scene.after)).toBe(before)
    }
  })

  it('allows later gloved saves only after the real ball enters expanded reach', () => {
    for (const side of [0, 1] as const) {
      const scene = stage({ side, lateralM: 1.2, ageTicks: 20 })
      const result = resolveAutomaticBallContact(
        scene.before, scene.after, scene.setup)
      expect(result.automaticContactEvents.at(-1)?.playerId)
        .toBe(scene.keeper.playerId)
      expect(result.automaticContactEvents.at(-1)?.outcome).toBe('parried')
      expect(result.ball.controllerId).toBeNull()
      expect(result.ball.lastTouchPlayerId).toBe(scene.keeper.playerId)
    }
  })

  it('retains central catches and strong-shot parries from actual sweeps', () => {
    const gentle = stage({ speedMps: 8, lateralM: 0 })
    const hard = stage({ speedMps: 31, lateralM: 0 })
    const caught = resolveAutomaticBallContact(
      gentle.before, gentle.after, gentle.setup)
    const parried = resolveAutomaticBallContact(
      hard.before, hard.after, hard.setup)
    expect(caught.automaticContactEvents.at(-1)?.outcome).toBe('caught')
    expect(caught.ball.controllerId).toBe(gentle.keeper.playerId)
    expect(parried.automaticContactEvents.at(-1)?.outcome).toBe('parried')
    expect(parried.ball.controllerId).toBeNull()
  })

  it('requires time to raise a glove to high shots', () => {
    const early = stage({ heightM: 2.20, ageTicks: 2 })
    const late = stage({ heightM: 2.20, ageTicks: 20 })
    expect(resolveAutomaticBallContact(
      early.before, early.after, early.setup).automaticContactEvents).toHaveLength(0)
    expect(resolveAutomaticBallContact(
      late.before, late.after, late.setup).automaticContactEvents.at(-1)?.playerId)
      .toBe(late.keeper.playerId)
  })

  it('differentiates extended reach by diving ability in the same trajectory', () => {
    const weaker = stage({ lateralM: 1.43, ageTicks: 20, diving: 10 })
    const stronger = stage({ lateralM: 1.43, ageTicks: 20, diving: 95 })
    // Distance is ~1.59m: beyond low-diving reach but within high reach.
    expect(resolveAutomaticBallContact(
      weaker.before, weaker.after, weaker.setup).automaticContactEvents).toHaveLength(0)
    expect(resolveAutomaticBallContact(
      stronger.before, stronger.after, stronger.setup).automaticContactEvents).toHaveLength(1)
  })

  it('varies physical parry momentum with goalkeeper parrying ability', () => {
    const weak = stage({ speedMps: 31, parrying: 10 })
    const skilled = stage({ speedMps: 31, parrying: 95 })
    const wa = resolveAutomaticBallContact(
      weak.before, weak.after, weak.setup)
    const sa = resolveAutomaticBallContact(
      skilled.before, skilled.after, skilled.setup)
    expect(wa.automaticContactEvents.at(-1)?.outcome).toBe('parried')
    expect(sa.automaticContactEvents.at(-1)?.outcome).toBe('parried')
    expect(sa.ball.velocity.xMps).toBeGreaterThan(wa.ball.velocity.xMps)
  })

  it('keeps real save movement frozen until reaction, then seeks the ball path', () => {
    for (const side of [0, 1] as const) {
      const scene = stage({ side, ageTicks: 2, speedMps: 20 })
      const early = planGoalkeeperSave(
        scene.after, scene.setup, scene.keeper, scene.team)
      expect(early?.engage).toBe(true)
      expect(early!.target).toEqual(scene.keeper.position)
      const late = {
        ...scene.after,
        clock: { ...scene.after.clock, tick: 70 },
      }
      const reacting = planGoalkeeperSave(
        late, scene.setup, scene.keeper, scene.team)
      expect(reacting?.engage).toBe(true)
      expect(reacting!.target.xM).not.toBeCloseTo(scene.keeper.position.xM)
    }
  })

  it('does not save without a physical shot or a collision', () => {
    const scene = stage({ ageTicks: 20, lateralM: 2.8 })
    const miss = resolveAutomaticBallContact(
      scene.before, scene.after, scene.setup)
    expect(miss.automaticContactEvents).toHaveLength(0)
    const nonShot: MatchState = {
      ...scene.after,
      contactEvents: [],
    }
    expect(planGoalkeeperSave(nonShot, scene.setup, scene.keeper, scene.team))
      .toBeNull()
  })
})
