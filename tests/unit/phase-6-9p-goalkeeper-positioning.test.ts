import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { planGoalkeeperPosition } from '../../src/game/ai/goalkeeper-positioning'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import type { MatchState } from '../../src/game/match/state'

function scenario(
  side: 0 | 1, xM: number, yM: number,
  possession: 'opponent' | 'teammate' | 'loose' = 'opponent',
) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const team = initial.teams[side]
  const keeper = initial.players.find(p =>
    p.clubId === team.clubId && p.formationSlot === 'GK')!
  const owner = initial.players.find(p =>
    p.formationSlot === 'ST' &&
    (possession === 'teammate'
      ? p.clubId === team.clubId
      : p.clubId !== team.clubId))!
  const controlled = possession !== 'loose'
  const players = initial.players.map(p =>
    p.playerId === owner.playerId
      ? { ...p, position: { xM, yM } }
      : p)
  const state: MatchState = {
    ...initial,
    kickoff: null,
    clock: { ...initial.clock, tick: 120 },
    players,
    ball: {
      ...initial.ball,
      position: { xM, yM }, heightM: .11,
      velocity: { xMps: 0, yMps: 0, zMps: 0 },
      controllerId: controlled ? owner.playerId : null,
      controlOffset: controlled ? { xM: 0, yM: 0 } : null,
      lastTouchPlayerId: owner.playerId,
    },
    ai: {
      ...initial.ai,
      enabledTeams: [true, true],
    },
  }
  return { setup, state, keeper, team, owner }
}

describe('Goalkeeper open-play positioning and angle management', () => {
  it('keeps both keepers within a realistic conservative goal-side zone', () => {
    for (const side of [0, 1] as const) {
      const xM = side === 0 ? 20 : 85
      const { setup, state, keeper, team } = scenario(side, xM, 34)
      const intent = planGoalkeeperPosition(state, setup, keeper, team)!
      const ownGoal = team.attackingDirection === 1 ? 0 : setup.pitch.lengthM
      const depth = (intent.target.xM - ownGoal) * team.attackingDirection
      expect(depth).toBeGreaterThan(1)
      expect(depth).toBeLessThan(8.2)
      expect(intent.target.yM).toBeCloseTo(34, 6)
      expect(intent.engage).toBe(false)
    }
  })

  it('narrows the near-post angle in either direction without chasing wide balls', () => {
    for (const side of [0, 1] as const) {
      const nearX = side === 0 ? 11 : 94
      const farX = side === 0 ? 60 : 45
      const near = scenario(side, nearX, 14)
      const far = scenario(side, farX, 14)
      const nearTarget = planGoalkeeperPosition(
        near.state, near.setup, near.keeper, near.team)!.target
      const farTarget = planGoalkeeperPosition(
        far.state, far.setup, far.keeper, far.team)!.target
      const centreY = near.setup.pitch.widthM / 2
      expect(nearTarget.yM).toBeLessThan(centreY)
      expect(Math.abs(nearTarget.yM - centreY))
        .toBeGreaterThan(Math.abs(farTarget.yM - centreY))
      expect(nearTarget.yM).toBeGreaterThanOrEqual(
        centreY - near.setup.pitch.goalWidthM / 2 - .8)
    }
  })

  it('steps out cautiously when danger is distant and retreats near goal', () => {
    const near = scenario(0, 9, 34)
    const far = scenario(0, 70, 34)
    const nearX = planGoalkeeperPosition(
      near.state, near.setup, near.keeper, near.team)!.target.xM
    const farX = planGoalkeeperPosition(
      far.state, far.setup, far.keeper, far.team)!.target.xM
    expect(farX).toBeGreaterThan(nearX + 3)
    expect(farX).toBeLessThan(8.2)
  })

  it('uses controlled, modest lateral movement in the build-up', () => {
    const own = scenario(0, 50, 12, 'teammate')
    const rival = scenario(0, 50, 12, 'opponent')
    const ownY = planGoalkeeperPosition(
      own.state, own.setup, own.keeper, own.team)!.target.yM
    const rivalY = planGoalkeeperPosition(
      rival.state, rival.setup, rival.keeper, rival.team)!.target.yM
    expect(Math.abs(ownY - 34)).toBeLessThan(Math.abs(rivalY - 34))
  })

  it('does not direct a ball-controlling goalkeeper away from possession', () => {
    const scene = scenario(0, 18, 30)
    const held = {
      ...scene.state,
      ball: { ...scene.state.ball, controllerId: scene.keeper.playerId },
    }
    expect(planGoalkeeperPosition(
      held, scene.setup, scene.keeper, scene.team)).toBeNull()
  })

  it('respects both teams and preserves the original world snapshot', () => {
    const scene = scenario(0, 26, 16)
    const before = JSON.stringify(scene.state)
    const decisions = planTeamDecisions(scene.state, scene.setup)
    for (const team of scene.state.teams) {
      const keeper = scene.state.players.find(p =>
        p.clubId === team.clubId && p.formationSlot === 'GK')!
      const decision = decisions.find(d => d.playerId === keeper.playerId)!
      expect(decision.action).toBe('shape')
      expect(decision.engage).toBe(false)
    }
    expect(JSON.stringify(scene.state)).toBe(before)
  })

  it('prioritizes an actual incoming shot over normal goal-side tracking', () => {
    const scene = scenario(0, 12, 34, 'loose')
    const shot: MatchState = {
      ...scene.state,
      ball: {
        ...scene.state.ball,
        velocity: { xMps: -24, yMps: 0, zMps: 0 },
      },
      contactEvents: [{
        tick: 119, playerId: scene.owner.playerId,
        kind: 'kick', outcome: 'kicked',
        commandId: 'ai-shot-positioning-test', drawUsed: 1,
      }],
    }
    const keeperAction = planTeamDecisions(shot, scene.setup).find(
      d => d.playerId === scene.keeper.playerId)!
    expect(keeperAction.action).toBe('save')
    expect(keeperAction.engage).toBe(true)
    expect(keeperAction.target.xM).toBeCloseTo(2.8)
  })
})
