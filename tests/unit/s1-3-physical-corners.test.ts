import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { applyDueMatchCommands, scheduleMatchCommand } from '../../src/game/match/commands'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { advanceBallPhysics, BALL_RADIUS_M } from '../../src/game/physics/ball'
import {
  classifyOutOfPlay, recordOutOfPlay, forbiddenRestartSecondTouch,
} from '../../src/game/match/restarts'
import {
  CORNER_OPPONENT_CLEAR_M, cornerBallSpot, cornerTakerTarget,
  cornerOpponentsClear, cornerOpponentRetreatTarget,
  cornerReceiverTargets, selectCornerTaker,
  stageCorner, advanceCornerStoppage,
} from '../../src/game/match/corners'
import { activeAerialDelivery } from '../../src/game/ai/goalkeeper-aerial'
import type { MatchState } from '../../src/game/match/state'

function cornerScene(side: 'left' | 'right', nearTop: boolean) {
  const setup = makeFictionalMatchSetup()
  const base = createFoundationMatch(setup).getState()
  const defender = base.teams[side === 'left' ? 0 : 1]
  const striker = base.teams[side === 'left' ? 1 : 0]
  const touched = base.players.find(p =>
    p.clubId === defender.clubId && p.formationSlot === 'RCB')!
  const goalX = side === 'left' ? 0 : setup.pitch.lengthM
  const goalDir = side === 'left' ? 1 : -1
  const y = nearTop ? 5 : setup.pitch.widthM - 5
  const before: MatchState = {
    ...base,
    clock: { ...base.clock, tick: 100 },
    ball: {
      ...base.ball,
      position: { xM: goalX + goalDir * .09, yM: y },
      controllerId: null, controlOffset: null,
      lastTouchPlayerId: touched.playerId,
      outsidePitch: false,
      velocity: { xMps: -goalDir * 10, yMps: 0, zMps: 0 },
    },
  }
  const after: MatchState = {
    ...before,
    clock: { ...before.clock, tick: 101 },
    ball: {
      ...before.ball,
      position: { xM: goalX - goalDir * .18, yM: y },
      outsidePitch: true,
    },
  }
  return { setup, before, after, touched, defender, striker, goalX, goalDir }
}
function ready(side: 'left' | 'right' = 'right', nearTop = true) {
  const scene = cornerScene(side, nearTop)
  const dead = recordOutOfPlay(scene.before, scene.after, scene.setup)
  const init: MatchState = {
    ...dead,
    ai: { ...dead.ai, enabledTeams: [true, true] },
  }
  const staging = stageCorner(init, scene.setup)
  // Fixture: position each player at the actual target their AI chose.
  // Normal live matches still require true 20Hz locomotion to reach it.
  const players = staging.players.map(p => ({
    ...p,
    position: p.intention.kind === 'moveToPoint'
      ? { ...p.intention.target } : p.position,
    velocity: { xMps: 0, yMps: 0 },
  }))
  const state: MatchState = {
    ...init,
    players, clock: { ...init.clock, tick: 145 },
  }
  return { ...scene, event: dead.restart!, state }
}

describe('S1.3 real corner-kick restarts', () => {
  it('correctly awards and places all four physical corner quadrants', () => {
    for (const side of ['left','right'] as const) {
      for (const top of [true,false]) {
        const scene = cornerScene(side, top)
        const award = classifyOutOfPlay(scene.before, scene.after, scene.setup)!
        expect(award.kind).toBe('corner')
        expect(award.awardedTeamId).toBe(scene.striker.clubId)
        expect(award.takerId).toBeNull()
        const state = recordOutOfPlay(scene.before, scene.after, scene.setup)
        const corner = cornerBallSpot(award, scene.setup.pitch)
        const flagX = side === 'left' ? 0 : scene.setup.pitch.lengthM
        const flagY = top ? 0 : scene.setup.pitch.widthM
        expect(Math.hypot(corner.xM - flagX, corner.yM - flagY))
          .toBeLessThan(1)
        expect(state.ball.position).toEqual(corner)
        expect(state.ball.heightM).toBe(BALL_RADIUS_M)
        expect(state.ball.outsidePitch).toBe(false)
        expect(state.ball.velocity).toEqual({xMps:0,yMps:0,zMps:0})
        expect(state.ball.controllerId).toBeNull()
      }
    }
  })

  it('stages a stable real taker, near/far post threats and defensive shape', () => {
    const scene = cornerScene('right',true)
    const dead: MatchState = {
      ...recordOutOfPlay(scene.before, scene.after, scene.setup),
      ai: { ...scene.before.ai, enabledTeams: [true,true] },
    }
    const event = dead.restart!
    const taker = selectCornerTaker(dead,event,scene.setup)!
    expect(taker.clubId).toBe(event.awardedTeamId)
    expect(taker.formationSlot).not.toBe('GK')
    const staged = stageCorner(dead, scene.setup)
    const next = stageCorner(staged, scene.setup)
    const run = staged.players.find(p => p.playerId === taker.playerId)!
    expect(run.position).toEqual(taker.position)
    expect(run.intention.kind).toBe('moveToPoint')
    if (run.intention.kind === 'moveToPoint') {
      expect(run.intention.target).toEqual(cornerTakerTarget(event,scene.setup.pitch))
    }
    expect(selectCornerTaker(next,event,scene.setup)?.playerId).toBe(taker.playerId)
    const near = cornerReceiverTargets(event,scene.setup.pitch).near
    expect(staged.players.some(p => p.clubId === event.awardedTeamId &&
      p.intention.kind === 'moveToPoint' &&
      Math.hypot(p.intention.target.xM - near.xM,
        p.intention.target.yM - near.yM) < .01)).toBe(true)
    expect(staged.pendingCommands.filter(c => c.type === 'attemptCornerKick'))
      .toHaveLength(0)
    expect(next.pendingCommands).toHaveLength(0)
  })

  it('enforces ten-yard clearance from corner ARC, not just from the football', () => {
    for (const side of ['left','right'] as const) {
      for (const nearTop of [true,false]) {
        const scene = cornerScene(side,nearTop)
        const dead = recordOutOfPlay(scene.before,scene.after,scene.setup)
        const event = dead.restart!
        const flag = {
          xM: side === 'left' ? 0 : scene.setup.pitch.lengthM,
          yM: nearTop ? 0 : scene.setup.pitch.widthM,
        }
        const near = {
          xM: flag.xM + scene.goalDir * 4.5,
          yM: flag.yM + (nearTop ? 1 : -1) * 2.8,
        }
        const target = cornerOpponentRetreatTarget(near,event,scene.setup.pitch)
        expect(Math.hypot(target.xM-flag.xM,target.yM-flag.yM))
          .toBeGreaterThan(CORNER_OPPONENT_CLEAR_M)
        expect(target.xM).toBeGreaterThanOrEqual(0)
        expect(target.xM).toBeLessThanOrEqual(scene.setup.pitch.lengthM)
        expect(target.yM).toBeGreaterThanOrEqual(0)
        expect(target.yM).toBeLessThanOrEqual(scene.setup.pitch.widthM)
      }
    }
  })

  it('does not accept forged ordinary kicks or an unauthorized corner', () => {
    const scene = cornerScene('left',false)
    const base = createFoundationMatch(scene.setup)
    const taker = base.getState().players.find(p =>
      p.clubId === scene.striker.clubId && p.formationSlot === 'LW')!
    expect(base.submitCommand({
      commandId:'forged-corner',
      teamId:taker.clubId,type:'attemptCornerKick',
      playerId:taker.playerId,target:{xM:24,yM:34},
      power:.6,lift:.78,
    }).accepted).toBe(false)
    const dead = recordOutOfPlay(scene.before,scene.after,scene.setup)
    const unauthorized = scheduleMatchCommand(dead,{
      commandId:'other-team-corner',type:'attemptCornerKick',
      teamId:scene.defender.clubId,playerId:scene.touched.playerId,
      target:{xM:24,yM:34},power:.5,lift:.7,
    },scene.setup.pitch)
    expect(unauthorized.receipt.accepted).toBe(false)
    const bypass = scheduleMatchCommand(dead,{
      commandId:'ordinary-dead-ball',type:'attemptKick',
      teamId:scene.striker.clubId,playerId:taker.playerId,
      target:{xM:24,yM:34},power:.5,lift:.7,
    },scene.setup.pitch)
    expect(bypass.receipt.accepted).toBe(false)
  })

  it('physically kicks a short or lofted delivery without inventing a receiver touch', () => {
    for (const side of ['left','right'] as const) {
      const scene = ready(side)
      expect(cornerOpponentsClear(scene.state,scene.event,scene.setup.pitch))
        .toBe(true)
      const staged = stageCorner(scene.state,scene.setup)
      const command = staged.pendingCommands.find(c =>
        c.type === 'attemptCornerKick')!
      expect(command).toBeDefined()
      expect(command.playerId).toBe(selectCornerTaker(
        scene.state,scene.event,scene.setup)?.playerId)
      expect(command.lift).toBeGreaterThan(.28)
      expect(command.power).toBeGreaterThan(.1)
      const applied = applyDueMatchCommands({
        ...staged, clock: { ...staged.clock, tick: 146 },
      })
      const kicked = advanceCornerStoppage(applied,scene.setup,resolveContactAttempts)
      expect(kicked.contactEvents.at(-1)?.kind).toBe('cornerKick')
      expect(kicked.contactEvents.at(-1)?.outcome).toBe('cornerKicked')
      expect(kicked.contactEvents.at(-1)?.drawUsed).toBe(1)
      expect(kicked.restart).toBeNull()
      expect(kicked.ball.controllerId).toBeNull()
      expect(kicked.ball.lastTouchPlayerId).toBe(command.playerId)
      expect(kicked.ball.heightM).toBe(BALL_RADIUS_M)
      expect(kicked.ball.velocity.zMps).toBeGreaterThan(0)
      expect(kicked.ball.velocity.yMps * (scene.event.spot.yM < 34 ? 1 : -1))
        .toBeGreaterThan(0)
      expect(forbiddenRestartSecondTouch(kicked,command.playerId)).toBe(true)
      const next = advanceBallPhysics(kicked.ball,scene.setup.pitch)
      expect(Math.hypot(next.position.xM-kicked.ball.position.xM,
        next.position.yM-kicked.ball.position.yM)).toBeGreaterThan(.15)
      const defending = kicked.teams.find(t =>
        t.clubId !== scene.event.awardedTeamId)!
      expect(activeAerialDelivery(kicked,scene.setup,defending)).not.toBeNull()
    }
  })

  it('chooses a genuinely short corner when the near-post crossing area is crowded', () => {
    const scene = ready('right', true)
    const near = cornerReceiverTargets(scene.event, scene.setup.pitch).near
    const deepPressured: MatchState = {
      ...scene.state,
      players: scene.state.players.map(p =>
        p.clubId === scene.defender.clubId &&
          ['ST', 'DM'].includes(p.formationSlot)
          ? {
              ...p, position: {xM:near.xM, yM:near.yM},
              velocity: {xMps:0,yMps:0},
            } : p),
    }
    expect(cornerOpponentsClear(deepPressured,scene.event,scene.setup.pitch))
      .toBe(true)
    const planned = stageCorner(deepPressured,scene.setup)
    const request = planned.pendingCommands.find(c =>
      c.type === 'attemptCornerKick')!
    expect(request).toBeDefined()
    expect(request.lift).toBe(.02)
    const applied = applyDueMatchCommands({
      ...planned, clock: { ...planned.clock, tick: 146 },
    })
    const contacted = advanceCornerStoppage(
      applied,scene.setup,resolveContactAttempts)
    expect(contacted.contactEvents.at(-1)?.outcome).toBe('cornerKicked')
    expect(contacted.ball.velocity.zMps).toBeGreaterThan(0)
  })

  it('holds a corner until nearby defenders have actually retreated', () => {
    const scene = ready('right',false)
    const defender = scene.state.players.find(p =>
      p.clubId === scene.defender.clubId && p.formationSlot === 'RB')!
    const flag = { xM: scene.setup.pitch.lengthM, yM: scene.setup.pitch.widthM }
    const unsafe: MatchState = {
      ...scene.state,
      players: scene.state.players.map(p => p.playerId === defender.playerId
        ? {
          ...p,
          position: {xM:flag.xM-3,yM:flag.yM-2},
          velocity: {xMps:0,yMps:0},
        } : p),
    }
    expect(cornerOpponentsClear(unsafe,scene.event,scene.setup.pitch)).toBe(false)
    expect(stageCorner(unsafe,scene.setup).pendingCommands.filter(c =>
      c.type === 'attemptCornerKick')).toHaveLength(0)
  })

  it('does not resume a failed release or change the ball without contact', () => {
    const scene = ready()
    const prepared = stageCorner(scene.state,scene.setup)
    const command = prepared.pendingCommands.find(c =>
      c.type === 'attemptCornerKick')!
    const taker = selectCornerTaker(scene.state,scene.event,scene.setup)!
    const applied = applyDueMatchCommands({
      ...prepared, clock: { ...prepared.clock, tick: 146 },
    })
    const displaced: MatchState = {
      ...applied, players: applied.players.map(p =>
        p.playerId === taker.playerId
          ? { ...p, position: {xM:50,yM:34} } : p),
    }
    const tested = advanceCornerStoppage(displaced,scene.setup,resolveContactAttempts)
    expect(tested.restart?.kind).toBe('corner')
    expect(tested.contactEvents.at(-1)?.outcome).toBe('notReady')
    expect(tested.ball.velocity).toEqual(scene.state.ball.velocity)
    expect(command.type).toBe('attemptCornerKick')
  })

  it('keeps baseline checkpoints deterministic before a restart', () => {
    const setup=makeFictionalMatchSetup()
    const engine=createFoundationMatch(setup)
    engine.advance(10)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint())
      .toEqual(engine.checkpoint())
  })
})
