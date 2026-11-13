import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { advanceBallPhysics } from '../../src/game/physics/ball'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { applyDueMatchCommands } from '../../src/game/match/commands'
import {
  classifyOutOfPlay, recordOutOfPlay, stageThrowIn,
  advanceThrowInStoppage, throwInTakerTarget, throwInReceiverTargets,
} from '../../src/game/match/restarts'
import type { MatchState } from '../../src/game/match/state'

function exitScene(side: 'top'|'bottom'|'left'|'right', touchedBy: 0|1=0) {
  const setup = makeFictionalMatchSetup()
  const state = createFoundationMatch(setup).getState()
  const touch = state.players.find(p =>
    p.clubId === state.teams[touchedBy].clubId && p.formationSlot === 'ST')!
  const { lengthM, widthM } = setup.pitch
  const inside = {
    xM: side === 'left' ? .05 : side === 'right' ? lengthM - .05 : 54,
    yM: side === 'top' ? .05 : side === 'bottom' ? widthM - .05 : 34,
  }
  const outside = {
    xM: side === 'left' ? -.14 : side === 'right' ? lengthM + .14 : 54,
    yM: side === 'top' ? -.14 : side === 'bottom' ? widthM + .14 : 34,
  }
  const before: MatchState = {
    ...state, clock: { ...state.clock, tick: 99 },
    ball: {
      ...state.ball, position: inside,
      lastTouchPlayerId: touch.playerId,
    },
  }
  const after: MatchState = {
    ...before, clock: { ...before.clock, tick: 100 },
    ball: {
      ...before.ball, position: outside, outsidePitch: true,
      velocity: { xMps: 0, yMps: -9, zMps: 0 },
    },
  }
  return { setup, before, after, touch }
}

describe('S1.1 physical touchline restarts', () => {
  it('classifies touchlines correctly on both sides and awards the OTHER club', () => {
    for (const side of ['top', 'bottom'] as const) {
      for (const touchedBy of [0, 1] as const) {
        const scene = exitScene(side, touchedBy)
        const event = classifyOutOfPlay(scene.before, scene.after, scene.setup)!
        expect(event.kind).toBe('throwIn')
        expect(event.side).toBe(side)
        expect(event.spot.yM).toBe(side === 'top' ? 0 : scene.setup.pitch.widthM)
        expect(event.awardedTeamId).toBe(scene.before.teams[1-touchedBy].clubId)
        expect(scene.after.players.find(p =>
          p.playerId === event.takerId)?.clubId).toBe(event.awardedTeamId)
        expect(scene.after.players.find(p =>
          p.playerId === event.takerId)?.formationSlot).not.toBe('GK')
      }
    }
  })

  it('distinguishes goal kicks from corners without pretending these restarts work yet', () => {
    for (const side of ['left', 'right'] as const) {
      const defenderIndex = side === 'left' ? 0 : 1
      const sceneDef = exitScene(side, defenderIndex)
      const corner = classifyOutOfPlay(
        sceneDef.before, sceneDef.after, sceneDef.setup)!
      expect(corner.kind).toBe('corner')
      expect(corner.awardedTeamId).toBe(sceneDef.before.teams[1-defenderIndex].clubId)
      expect(corner.takerId).toBeNull()
      const sceneAtt = exitScene(side, 1-defenderIndex as 0|1)
      const goalKick = classifyOutOfPlay(
        sceneAtt.before, sceneAtt.after, sceneAtt.setup)!
      expect(goalKick.kind).toBe('goalKick')
      expect(goalKick.awardedTeamId).toBe(sceneAtt.before.teams[defenderIndex].clubId)
      expect(goalKick.takerId).toBeNull()
    }
  })

  it('does not invent restarts before the whole ball is out or after a goal', () => {
    const scene = exitScene('top')
    expect(classifyOutOfPlay(scene.before, {
      ...scene.after,
      ball: { ...scene.after.ball, outsidePitch: false },
    }, scene.setup)).toBeNull()
    expect(classifyOutOfPlay(scene.before, {
      ...scene.after, goalEvents: [{
        tick: 100, side: 'left',
        scoringTeamId: scene.before.teams[1].clubId,
        lastTouchPlayerId: scene.touch.playerId,
        ownGoal: false, crossingY: 34, crossingHeightM: .11,
      }],
    }, scene.setup)).toBeNull()
    expect(classifyOutOfPlay(scene.after, scene.after, scene.setup)).toBeNull()
  })

  it('uses the FIRST painted boundary when a diagonal ball passes near a corner', () => {
    const scene = exitScene('top')
    const cornerApproach = {
      ...scene.before,
      ball: {
        ...scene.before.ball,
        position: { xM: .2, yM: .05 },
      },
    }
    const after = {
      ...scene.after,
      ball: {
        ...scene.after.ball,
        position: { xM: -.2, yM: -.28 },
      },
    }
    // Y=0 is crossed at ~15%, x=0 at 50%: touchline was first.
    expect(classifyOutOfPlay(cornerApproach, after, scene.setup)?.side)
      .toBe('top')
  })

  it('freezes the actual dead ball and clears stale passing intent once', () => {
    const scene = exitScene('top')
    const recorded = recordOutOfPlay(scene.before, scene.after, scene.setup)
    expect(recorded.restart?.kind).toBe('throwIn')
    expect(recorded.outOfPlayEvents).toHaveLength(1)
    expect(recorded.ball.outsidePitch).toBe(true)
    expect(recorded.ball.controllerId).toBeNull()
    expect(recorded.ball.velocity).toEqual({xMps:0,yMps:0,zMps:0})
    expect(recordOutOfPlay(recorded, recorded, scene.setup).outOfPlayEvents)
      .toHaveLength(1)
  })

  it('stages a real taker and stable options before scheduling a physical throw', () => {
    const scene = exitScene('top')
    const recorded = recordOutOfPlay(scene.before, scene.after, scene.setup)
    const restart = recorded.restart!
    const receiverTargets = throwInReceiverTargets(restart, scene.setup)
    const originalStaged = stageThrowIn(recorded, scene.setup)
    expect(originalStaged.pendingCommands).toHaveLength(0)
    const takerTarget = throwInTakerTarget(restart, scene.setup)
    const options = recorded.players.filter(p =>
      p.clubId === restart.awardedTeamId &&
      p.playerId !== restart.takerId && p.formationSlot !== 'GK')
      .sort((a,b)=>{
        const point = (p: typeof a) => recorded.ai.formationPositions[p.playerId]
        return Math.hypot(point(a).xM - restart.spot.xM,
          point(a).yM - restart.spot.yM) -
          Math.hypot(point(b).xM - restart.spot.xM,
            point(b).yM - restart.spot.yM) ||
          a.playerId.localeCompare(b.playerId)
      })
    const readyPlayers = recorded.players.map(p =>
      p.playerId === restart.takerId ? {
        ...p, position: takerTarget,
      } : p.playerId === options[0].playerId ? {
        ...p, position: receiverTargets[0],
      } : p)
    const ready: MatchState = {
      ...recorded,
      clock: { ...recorded.clock, tick: 130 },
      players: readyPlayers,
      ai: { ...recorded.ai, enabledTeams: [true,true] },
    }
    const planned = stageThrowIn(ready, scene.setup)
    expect(planned.pendingCommands.filter(c =>
      c.type === 'attemptThrowIn')).toHaveLength(1)
    const cmd = planned.pendingCommands.find(c =>
      c.type === 'attemptThrowIn')!
    expect(cmd.teamId).toBe(restart.awardedTeamId)
    expect(cmd.playerId).toBe(restart.takerId)
    expect(cmd.target).toEqual(receiverTargets[0])
    expect(stageThrowIn(planned, scene.setup).pendingCommands)
      .toHaveLength(planned.pendingCommands.length)
  })

  it('releases a real lofted throw via scheduled contact, not via awarded possession', () => {
    const scene = exitScene('bottom')
    const recorded = recordOutOfPlay(scene.before, scene.after, scene.setup)
    const restart = recorded.restart!
    const receiverTargets = throwInReceiverTargets(restart, scene.setup)
    const takerTarget = throwInTakerTarget(restart, scene.setup)
    const receiver = recorded.players.filter(p =>
      p.clubId === restart.awardedTeamId &&
      p.playerId !== restart.takerId && p.formationSlot !== 'GK')
      .sort((a,b)=>{
        const point = (p: typeof a) => recorded.ai.formationPositions[p.playerId]
        return Math.hypot(point(a).xM - restart.spot.xM,
          point(a).yM - restart.spot.yM) -
          Math.hypot(point(b).xM - restart.spot.xM,
            point(b).yM - restart.spot.yM) ||
          a.playerId.localeCompare(b.playerId)
      })[0]
    const ready: MatchState = {
      ...recorded, clock: { ...recorded.clock, tick: 130 },
      ai: { ...recorded.ai, enabledTeams: [true,true] },
      players: recorded.players.map(p => p.playerId === restart.takerId
        ? { ...p, position: takerTarget }
        : p.playerId === receiver.playerId
          ? { ...p, position: receiverTargets[0] } : p),
    }
    const staged = stageThrowIn(ready, scene.setup)
    const command = staged.pendingCommands.find(c =>
      c.type === 'attemptThrowIn')!
    expect(command).toBeDefined()
    const applied = applyDueMatchCommands({
      ...staged, clock: { ...staged.clock, tick: 131 },
    })
    const continued = advanceThrowInStoppage(
      applied, scene.setup, resolveContactAttempts)
    const release = continued.contactEvents.at(-1)!
    expect(release.kind).toBe('throwIn')
    expect(release.outcome).toBe('thrownIn')
    expect(release.drawUsed).toBe(1)
    expect(continued.restart).toBeNull()
    expect(continued.ball.outsidePitch).toBe(false)
    expect(continued.ball.controllerId).toBeNull()
    expect(continued.ball.lastTouchPlayerId).toBe(restart.takerId)
    expect(continued.ball.velocity.zMps).toBeGreaterThan(0)
    expect(continued.ball.position).toEqual(restart.spot)
    expect(advanceBallPhysics(continued.ball, scene.setup.pitch).position.yM)
      .toBeLessThan(restart.spot.yM)
    expect(command.type).toBe('attemptThrowIn')
  })

  it('prevents arbitrary throw commands while ordinary play is running', () => {
    const setup = makeFictionalMatchSetup()
    const engine = createFoundationMatch(setup)
    expect(engine.submitCommand({
      commandId:'forged-throw',
      type:'attemptThrowIn',
      teamId:setup.clubs[0].id,
      playerId:setup.teams[0].starters[1].playerId,
      target:{xM:54,yM:34},power:.5,
    }).accepted).toBe(false)
  })

  it('retains deterministic restart-free checkpoint replay as baseline', () => {
    const setup = makeFictionalMatchSetup()
    const engine = createFoundationMatch(setup)
    engine.advance(10)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint())
      .toEqual(engine.checkpoint())
  })
})
