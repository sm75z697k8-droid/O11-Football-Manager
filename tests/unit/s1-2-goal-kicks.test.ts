import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { applyDueMatchCommands, scheduleMatchCommand } from '../../src/game/match/commands'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { advanceBallPhysics } from '../../src/game/physics/ball'
import { classifyOutOfPlay, recordOutOfPlay, forbiddenRestartSecondTouch } from '../../src/game/match/restarts'
import {
  goalKickSpot, goalKickTaker, goalKickReceiverTargets,
  insideRestartPenaltyArea, stageGoalKick, advanceGoalKickStoppage,
} from '../../src/game/match/goal-kicks'
import type { MatchState } from '../../src/game/match/state'

function exit(side: 'left' | 'right') {
  const setup = makeFictionalMatchSetup()
  const original = createFoundationMatch(setup).getState()
  const defending = side === 'left' ? original.teams[0] : original.teams[1]
  const direction = side === 'left' ? 1 : -1
  const goalX = side === 'left' ? 0 : setup.pitch.lengthM
  const attacker = original.players.find(p =>
    p.clubId !== defending.clubId && p.formationSlot === 'ST')!
  const before: MatchState = {
    ...original, clock: { ...original.clock, tick: 100 },
    ball: {
      ...original.ball, position: { xM: goalX + direction * .08, yM: 27 },
      controllerId: null, controlOffset: null,
      lastTouchPlayerId: attacker.playerId,
      outsidePitch: false,
      velocity: { xMps: -direction * 9, yMps: 0, zMps: 0 },
    },
  }
  const after: MatchState = {
    ...before, clock: { ...before.clock, tick: 101 },
    ball: {
      ...before.ball,
      position: { xM: goalX - direction * .17, yM: 27 },
      outsidePitch: true,
    },
  }
  return { setup, before, after, direction, defending, attacker }
}
function ready(side: 'left'|'right', pressured = false) {
  const scene = exit(side)
  const stopped = recordOutOfPlay(scene.before, scene.after, scene.setup)
  const event = stopped.restart!
  const spot = goalKickSpot(event, scene.setup.pitch)
  const keeper = goalKickTaker(stopped, event)!
  const targets = goalKickReceiverTargets(event, scene.setup)
  const players = stopped.players.map(p => {
    if (p.playerId === keeper.playerId) return {
      ...p,
      position: { xM: spot.xM + scene.direction * .43, yM: spot.yM },
      velocity: { xMps: 0, yMps: 0 },
    }
    if (p.clubId === scene.defending.clubId &&
        (p.formationSlot === 'RCB' || p.formationSlot === 'LCB')) {
      return {
        ...p,
        position: targets[p.formationSlot === 'RCB' ? 0 : 1],
        velocity: { xMps: 0, yMps: 0 },
      }
    }
    if (p.clubId !== scene.defending.clubId) {
      const y = pressured
        ? p.formationSlot === 'RW' ? targets[0].yM :
          p.formationSlot === 'LW' ? targets[1].yM : p.position.yM
        : p.position.yM
      const goalX = side === 'left' ? 0 : scene.setup.pitch.lengthM
      const d = Math.abs(p.position.xM - goalX)
      const xM = pressured && ['RW','LW'].includes(p.formationSlot)
        ? goalX + scene.direction * (scene.setup.pitch.penaltyAreaDepthM + .6)
        : d < scene.setup.pitch.penaltyAreaDepthM + .2
          ? goalX + scene.direction * (scene.setup.pitch.penaltyAreaDepthM + 2.5)
          : p.position.xM
      return {
        ...p, position: { xM, yM: y },
        velocity: { xMps: 0, yMps: 0 },
      }
    }
    return p
  })
  const state: MatchState = {
    ...stopped,
    clock: { ...stopped.clock, tick: 131 },
    ai: { ...stopped.ai, enabledTeams: [true, true] },
    players,
  }
  return { ...scene, stopped, event, state, keeper, spot, targets }
}

describe('S1.2 real Law 16 goal-kick continuations', () => {
  it('awards goal kicks correctly at both ends from a real attacking last touch', () => {
    for (const side of ['left', 'right'] as const) {
      const scene = exit(side)
      const award = classifyOutOfPlay(scene.before, scene.after, scene.setup)
      expect(award?.kind).toBe('goalKick')
      expect(award?.side).toBe(side)
      expect(award?.awardedTeamId).toBe(scene.defending.clubId)
      expect(award?.lastTouchPlayerId).toBe(scene.attacker.playerId)
      expect(award?.takerId).toBeNull()
      const stopped = recordOutOfPlay(scene.before, scene.after, scene.setup)
      const spot = goalKickSpot(award!, scene.setup.pitch)
      const depth = side === 'left' ? spot.xM :
        scene.setup.pitch.lengthM - spot.xM
      expect(depth).toBeGreaterThan(0)
      expect(depth).toBeLessThan(scene.setup.pitch.goalAreaDepthM)
      expect(Math.abs(spot.yM - scene.setup.pitch.widthM/2))
        .toBeLessThan(scene.setup.pitch.goalAreaWidthM / 2)
      expect(stopped.ball.position).toEqual(spot)
      expect(stopped.ball.outsidePitch).toBe(false)
      expect(stopped.ball.velocity).toEqual({xMps:0,yMps:0,zMps:0})
      expect(stopped.ball.controllerId).toBeNull()
      expect(stopped.ball.lastTouchPlayerId).toBe(scene.attacker.playerId)
      expect(stopped.restart).toEqual(award)
    }
  })

  it('moves the goalkeeper, both defenders and intruding opponents through real locomotion', () => {
    for (const side of ['left', 'right'] as const) {
      const scene = exit(side)
      const dead = recordOutOfPlay(scene.before, scene.after, scene.setup)
      const keeper = goalKickTaker(dead, dead.restart!)!
      const intruder = dead.players.find(p =>
        p.clubId !== scene.defending.clubId && p.formationSlot === 'ST')!
      const goalX = side === 'left' ? 0 : scene.setup.pitch.lengthM
      const players = dead.players.map(p =>
        p.playerId === intruder.playerId ? {
          ...p, position: { xM: goalX + scene.direction * 9, yM: 34 },
        } : p)
      const state: MatchState = {
        ...dead, players,
        ai: { ...dead.ai, enabledTeams: [true, true] },
      }
      const staged = stageGoalKick(state, scene.setup)
      const stagedGK = staged.players.find(p => p.playerId === keeper.playerId)!
      const stagedIntruder = staged.players.find(p => p.playerId === intruder.playerId)!
      expect(stagedGK.position).toEqual(keeper.position)
      expect(stagedGK.intention.kind).toBe('moveToPoint')
      expect(stagedIntruder.position).toEqual(players.find(p =>
        p.playerId === intruder.playerId)!.position)
      expect(stagedIntruder.intention.kind).toBe('moveToPoint')
      if (stagedIntruder.intention.kind === 'moveToPoint') {
        expect(insideRestartPenaltyArea(stagedIntruder.intention.target,
          dead.restart!, scene.setup.pitch)).toBe(false)
      }
      const moved = advanceGoalKickStoppage({
        ...staged, clock: { ...staged.clock, tick: 102 },
      }, scene.setup, resolveContactAttempts)
      expect(moved.restart?.kind).toBe('goalKick')
      expect(moved.ball.position).toEqual(dead.ball.position)
      expect(moved.ball.velocity).toEqual(dead.ball.velocity)
      expect(Math.hypot(
        moved.players.find(p => p.playerId === intruder.playerId)!.position.xM -
          stagedIntruder.position.xM,
        moved.players.find(p => p.playerId === intruder.playerId)!.position.yM -
          stagedIntruder.position.yM)).toBeLessThan(.6)
    }
  })

  it('rejects illegal keeper kicks and ordinary bypass touches while ball is dead', () => {
    const scene = exit('left')
    const engine = createFoundationMatch(scene.setup)
    const goalie = engine.getState().players.find(p => p.formationSlot === 'GK')!
    expect(engine.submitCommand({
      commandId: 'forged-goalkick', teamId: goalie.clubId,
      type: 'attemptGoalKick', playerId: goalie.playerId,
      target: { xM: 25, yM: 34 }, power: .4, lift: 0,
    }).accepted).toBe(false)
    const dead = recordOutOfPlay(scene.before, scene.after, scene.setup)
    const wrong = scheduleMatchCommand(dead, {
      commandId: 'wrong-team-goal-kick',
      type: 'attemptGoalKick',
      teamId: scene.attacker.clubId,
      playerId: scene.attacker.playerId,
      target: { xM: 40, yM: 34 }, power: .4, lift: 0,
    }, scene.setup.pitch)
    expect(wrong.receipt.accepted).toBe(false)
    const ordinary = scheduleMatchCommand(dead, {
      commandId: 'ordinary-bypass',
      teamId: scene.attacker.clubId,
      type: 'attemptKick', playerId: scene.attacker.playerId,
      target: { xM: 40, yM: 34 }, power: .4, lift: 0,
    }, scene.setup.pitch)
    expect(ordinary.receipt.accepted).toBe(false)
  })

  it('creates a real on-target kick with seeded contact, then resumes normal physics', () => {
    for (const side of ['left', 'right'] as const) {
      const scene = ready(side)
      const staged = stageGoalKick(scene.state, scene.setup)
      const command = staged.pendingCommands.find(c =>
        c.type === 'attemptGoalKick')!
      expect(command).toBeDefined()
      expect(command.teamId).toBe(scene.defending.clubId)
      expect(command.playerId).toBe(scene.keeper.playerId)
      expect(command.lift).toBe(0)
      const due = applyDueMatchCommands({
        ...staged, clock: { ...staged.clock, tick: 132 },
      })
      const executed = advanceGoalKickStoppage(
        due, scene.setup, resolveContactAttempts)
      const event = executed.contactEvents.at(-1)!
      expect(event.kind).toBe('goalKick')
      expect(event.outcome).toBe('goalKicked')
      expect(event.drawUsed).toBe(1)
      expect(executed.restart).toBeNull()
      expect(executed.ball.position).toEqual(scene.spot)
      expect(executed.ball.lastTouchPlayerId).toBe(scene.keeper.playerId)
      expect(executed.ball.controllerId).toBeNull()
      expect(executed.ball.velocity.xMps * scene.direction).toBeGreaterThan(0)
      expect(executed.ball.velocity.zMps).toBe(0)
      expect(executed.ai.passIntent?.receiverId).not.toBe(scene.keeper.playerId)
      const moving = advanceBallPhysics(executed.ball, scene.setup.pitch)
      expect(Math.abs(moving.position.xM - scene.spot.xM)).toBeGreaterThan(.1)
      expect(moving.outsidePitch).toBe(false)
      expect(forbiddenRestartSecondTouch(executed, scene.keeper.playerId))
        .toBe(true)
    }
  })

  it('can select a lofted midfield distribution when both short outlets are crowded', () => {
    const scene = ready('left', true)
    const target = stageGoalKick(scene.state, scene.setup).pendingCommands
      .find(c => c.type === 'attemptGoalKick')
    expect(target?.type).toBe('attemptGoalKick')
    expect(target?.lift).toBeGreaterThan(0)
    expect(scene.state.players.some(p => p.clubId !== scene.defending.clubId &&
      insideRestartPenaltyArea(p.position, scene.event, scene.setup.pitch)))
      .toBe(false)
  })

  it('does not stage a goal kick without an actual award or autonomous taker', () => {
    const scene = ready('right')
    const disabled: MatchState = {
      ...scene.state,
      ai: { ...scene.state.ai, enabledTeams: [true, false] },
    }
    expect(stageGoalKick(disabled, scene.setup)).toEqual(disabled)
    const noAward: MatchState = { ...scene.state, restart: null }
    expect(stageGoalKick(noAward, scene.setup)).toEqual(noAward)
  })
})

