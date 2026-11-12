import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import type { BallMatchState, MatchState } from '../../src/game/match/state'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { createSimulationClock } from '../../src/game/core/clock'
import { advanceBallPhysics, BALL_RADIUS_M } from '../../src/game/physics/ball'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { applyDueMatchCommands, scheduleMatchCommand } from '../../src/game/match/commands'
import {
  adjudicatePhysicalGoal, detectGoalMouthCrossing,
} from '../../src/game/match/goals'
import {
  attackingOpportunityAt, evaluateShootingOpportunity,
  planGoalkeeperSave, trackGoalkeeperSaves,
} from '../../src/game/ai/goal-directed'
import { evaluateOnBallChoice } from '../../src/game/ai/possession'

const makeBall = (x: number, y = 34, h = BALL_RADIUS_M): BallMatchState => ({
  position: { xM: x, yM: y }, heightM: h,
  velocity: { xMps: 13, yMps: 0, zMps: 0 },
  outsidePitch: x < -BALL_RADIUS_M || x > 105 + BALL_RADIUS_M,
  controllerId: null, controlOffset: null, lastTouchPlayerId: 'harbor_player_10',
})

describe('Phase 6.7 actual full-ball goalmouth crossings', () => {
  const setup = makeFictionalMatchSetup()
  const right = makeBall(105.3)
  const rightBefore = makeBall(104.8)
  it('awards only the whole ball crossing right between posts and under bar', () => {
    const result = detectGoalMouthCrossing(rightBefore, right, setup.pitch)
    expect(result?.side).toBe('right')
    expect(result?.crossingY).toBeCloseTo(34, 7)
    expect(result?.crossingHeightM).toBeCloseTo(BALL_RADIUS_M, 7)
    expect(detectGoalMouthCrossing(rightBefore, makeBall(105.07), setup.pitch))
      .toBeNull()
  })
  it('recognizes the mirrored left goal and respects ball radius', () => {
    const before = makeBall(.3)
    const after = makeBall(-.25)
    const crossing = detectGoalMouthCrossing(before, after, setup.pitch)
    expect(crossing?.side).toBe('left')
    expect(detectGoalMouthCrossing(before, makeBall(-.07), setup.pitch)).toBeNull()
  })
  it('rejects wide, high, corner and already-outside balls', () => {
    for (const y of [30.1, 37.9, -1, 69]) {
      expect(detectGoalMouthCrossing(makeBall(104.8, y),
        makeBall(105.3, y), setup.pitch)).toBeNull()
    }
    expect(detectGoalMouthCrossing(
      makeBall(104.8, 34, 2.7),
      makeBall(105.3, 34, 2.7), setup.pitch)).toBeNull()
    expect(detectGoalMouthCrossing(
      makeBall(105.3), makeBall(106), setup.pitch)).toBeNull()
  })
  it('interpolates crossing HEIGHT instead of accepting an eventual below-bar position', () => {
    const raisedBefore = makeBall(104.8, 34, 3.3)
    const lowered = makeBall(105.3, 34, 2.0)
    expect(detectGoalMouthCrossing(raisedBefore, lowered, setup.pitch))
      .toBeNull()
  })
  it('records exactly one actual goal including physical own-goal attribution', () => {
    const original = createFoundationMatch(setup).getState()
    const scorer = original.players.find(p => p.formationSlot === 'ST' &&
      p.clubId === setup.clubs[0].id)!
    const previous: MatchState = {
      ...original, ball: {
        ...rightBefore, lastTouchPlayerId: scorer.playerId,
      },
    }
    const after: MatchState = {
      ...previous, clock: createSimulationClock(1),
      ball: { ...right, lastTouchPlayerId: scorer.playerId },
    }
    const confirmed = adjudicatePhysicalGoal(previous, after, setup)
    expect(confirmed.teams.map(t => t.score)).toEqual([1, 0])
    expect(confirmed.goalEvents).toHaveLength(1)
    expect(confirmed.goalEvents[0]).toMatchObject({
      side: 'right', ownGoal: false,
      lastTouchPlayerId: scorer.playerId, scoringTeamId: setup.clubs[0].id,
      tick: 1,
    })
    expect(adjudicatePhysicalGoal(after, confirmed, setup)).toEqual(confirmed)
    const leftScorer = original.players.find(p =>
      p.clubId === setup.clubs[0].id && p.formationSlot === 'RCB')!
    const leftBefore: MatchState = {
      ...original, ball: { ...makeBall(.3),
        lastTouchPlayerId: leftScorer.playerId },
    }
    const leftAfter: MatchState = {
      ...leftBefore, clock: createSimulationClock(1),
      ball: { ...makeBall(-.3), lastTouchPlayerId: leftScorer.playerId },
    }
    const own = adjudicatePhysicalGoal(leftBefore, leftAfter, setup)
    expect(own.teams.map(t => t.score)).toEqual([0, 1])
    expect(own.goalEvents[0].ownGoal).toBe(true)
  })
  it('never awards a goal to a diagnostic ball with no real player touch', () => {
    const original = createFoundationMatch(setup).getState()
    const previous: MatchState = {
      ...original,
      ball: { ...rightBefore, lastTouchPlayerId: null },
    }
    const next: MatchState = {
      ...previous,
      clock: createSimulationClock(1),
      ball: { ...right, lastTouchPlayerId: null },
    }
    expect(adjudicatePhysicalGoal(previous, next, setup)).toEqual(next)
  })
  it('physically executes a player kick that travels over the line and scores', () => {
    const original = createFoundationMatch(setup).getState()
    const shooter = original.players.find(p =>
      p.clubId === setup.clubs[0].id && p.formationSlot === 'ST')!
    const ready: MatchState = {
      ...original,
      players: original.players.map(p => p.playerId === shooter.playerId
        ? { ...p, position: { xM: 88, yM: 34 }, orientationRad: 0 } : p),
      ball: {
        ...original.ball, position: { xM: 88, yM: 34 },
        controllerId: shooter.playerId,
        controlOffset: { xM: 0, yM: 0 },
        lastTouchPlayerId: shooter.playerId,
      },
    }
    const queued = scheduleMatchCommand(ready, {
      type: 'attemptKick', teamId: shooter.clubId,
      playerId: shooter.playerId, commandId: 'ai-shot-0-physical',
      target: { xM: 105, yM: 34 }, power: .93, lift: .07,
    }, setup.pitch)
    expect(queued.receipt.accepted).toBe(true)
    const due = applyDueMatchCommands({
      ...queued.state, clock: createSimulationClock(1),
    })
    let match = resolveContactAttempts(due, setup)
    expect(match.contactEvents[0]).toMatchObject({
      kind: 'kick', outcome: 'kicked',
    })
    expect(match.ball.velocity.xMps).toBeGreaterThan(10)
    let scored = false
    for (let tick = 2; tick < 60; tick++) {
      const nextBall = advanceBallPhysics(match.ball, setup.pitch)
      const next: MatchState = {
        ...match, clock: createSimulationClock(tick), ball: nextBall,
      }
      match = adjudicatePhysicalGoal(match, next, setup)
      if (match.goalEvents.length) { scored = true; break }
      if (match.ball.outsidePitch) break
    }
    expect(scored).toBe(true)
    expect(match.goalEvents[0].lastTouchPlayerId).toBe(shooter.playerId)
    expect(match.teams[0].score).toBe(1)
  })
})

describe('Phase 6.7 chance-led decisions and goalkeeper movement', () => {
  const setup = makeFictionalMatchSetup()
  const original = createFoundationMatch(setup).getState()
  it('offers a credible physical shot from the centre of the penalty area', () => {
    const striker = original.players.find(p => p.clubId === setup.clubs[0].id &&
      p.formationSlot === 'ST')!
    const shooter = { ...striker, position: { xM: 93, yM: 34 } }
    const opponents = original.players.filter(p => p.clubId !== striker.clubId)
      .map(p => p.formationSlot === 'GK'
        ? p : { ...p, position: { xM: 69, yM: p.position.yM } })
    const def = setup.players.find(p => p.id === striker.playerId)!
    const shot = evaluateShootingOpportunity(
      shooter, def, opponents, original.teams[0], setup)
    expect(shot).not.toBeNull()
    expect(shot!.target.xM).toBe(105)
    expect(shot!.target.yM).toBeGreaterThan(30)
    expect(shot!.target.yM).toBeLessThan(38)
    expect(shot!.chanceQuality).toBeGreaterThan(0)
    expect(shot!.power).toBeGreaterThan(.7)
    const controlled: MatchState = {
      ...original,
      players: original.players.map(p =>
        p.playerId === striker.playerId ? shooter :
          p.clubId !== striker.clubId && p.formationSlot !== 'GK' ?
            { ...p, position: { xM: 69, yM: p.position.yM } } : p),
      ball: {
        ...original.ball, controllerId: striker.playerId,
        lastTouchPlayerId: striker.playerId,
        position: shooter.position, controlOffset: { xM: 0, yM: 0 },
      },
    }
    expect(evaluateOnBallChoice(controlled, setup)?.kind).toBe('shoot')
  })
  it('refuses shots from midfield, impossible angles, or obstructed corridors', () => {
    const striker = original.players[9]
    const def = setup.players.find(p => p.id === striker.playerId)!
    const away = original.players.filter(p => p.clubId !== striker.clubId)
    expect(evaluateShootingOpportunity(
      { ...striker, position: { xM: 52, yM: 34 } },
      def, away, original.teams[0], setup)).toBeNull()
    expect(evaluateShootingOpportunity(
      { ...striker, position: { xM: 88, yM: 67 } },
      def, away, original.teams[0], setup)).toBeNull()
    const clear = evaluateShootingOpportunity(
      { ...striker, position: { xM: 87, yM: 34 } },
      def, away.map(p => p.formationSlot === 'GK' ? p :
        { ...p, position: { xM: 57, yM: 11 } }),
      original.teams[0], setup)
    const blocked = evaluateShootingOpportunity(
      { ...striker, position: { xM: 87, yM: 34 } },
      def, away.map((p, i) => i < 2 ? {
        ...p, position: { xM: 93, yM: i ? 34.3 : 33.8 },
      } : p),
      original.teams[0], setup)
    expect(clear).not.toBeNull()
    expect(blocked).not.toBeNull()
    expect(blocked!.utility).toBeLessThan(clear!.utility)
  })
  it('values passing to a player with better goalward access', () => {
    const opponents = original.players.filter(p =>
      p.clubId === setup.clubs[1].id)
    const team = original.teams[0]
    const distant = attackingOpportunityAt({ xM: 55, yM: 34 },
      team, setup, opponents)
    const close = attackingOpportunityAt({ xM: 92, yM: 34 },
      team, setup, opponents.filter(p => p.formationSlot === 'GK'))
    expect(close).toBeGreaterThan(distant)
  })
  it('makes a goalkeeper attempt a real save, without awarding a fake contact', () => {
    const keeper = original.players.find(p =>
      p.clubId === setup.clubs[1].id && p.formationSlot === 'GK')!
    const shooter = original.players.find(p =>
      p.clubId === setup.clubs[0].id && p.formationSlot === 'ST')!
    const state: MatchState = {
      ...original,
      clock: createSimulationClock(26),
      ai: { ...original.ai, enabledTeams: [true, true],
        lastDecisionTick: 24,
        decisionSnapshot: [] },
      ball: {
        ...original.ball, position: { xM: 88, yM: 34 },
        velocity: { xMps: 23, yMps: 1, zMps: 1 },
        controllerId: null, controlOffset: null,
        lastTouchPlayerId: shooter.playerId,
      },
      contactEvents: [{
        commandId: 'ai-shot-23-' + shooter.playerId,
        kind: 'kick', outcome: 'kicked',
        tick: 24, playerId: shooter.playerId, drawUsed: 1,
      }],
    }
    const save = planGoalkeeperSave(state, setup, keeper, state.teams[1])
    expect(save?.engage).toBe(true)
    expect(save!.target.xM).toBeGreaterThan(98)
    expect(save!.target.yM).toBeGreaterThan(30)
    const updated = trackGoalkeeperSaves(state, setup)
    const updatedKeeper = updated.players.find(p => p.playerId === keeper.playerId)!
    expect(updatedKeeper.engagesBall).toBe(true)
    expect(updatedKeeper.intention.kind).toBe('moveToPoint')
    expect(updated.ball).toEqual(state.ball)
    expect(updated.contactEvents).toEqual(state.contactEvents)
    expect(updated.goalEvents).toEqual([])
  })
  it('preserves existing full-engine deterministic replay', () => {
    const game = createFoundationMatch(setup)
    for (const club of setup.clubs) {
      expect(game.submitCommand({
        commandId: 'phase67-enable-' + club.id,
        type: 'setAutonomousTeam', teamId: club.id, enabled: true,
      }).accepted).toBe(true)
    }
    game.advance(300)
    const clone = restoreFoundationMatch(game.checkpoint())
    game.advance(80)
    clone.advance(35)
    clone.advance(45)
    expect(clone.checkpoint()).toEqual(game.checkpoint())
  })
})
