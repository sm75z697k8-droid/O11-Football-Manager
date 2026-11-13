import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import {
  openingKickoffPass, OPENING_KICKOFF_COMMAND_ID,
} from '../../src/game/match/kickoff'
import type { MatchSetup } from '../../src/game/model/match'

const kickoffFixture = (teamId = 'club_harbor'): MatchSetup => ({
  ...makeFictionalMatchSetup(), kickoff: { teamId },
})

function matchStarted(teamId = 'club_harbor') {
  const engine = createFoundationMatch(kickoffFixture(teamId))
  for (const club of engine.getSetup().clubs) {
    expect(engine.submitCommand({
      commandId: 'enable-' + club.id, type: 'setAutonomousTeam',
      teamId: club.id, enabled: true,
    }).accepted).toBe(true)
  }
  const kickoff = openingKickoffPass(engine.getState())
  expect(engine.submitCommand(kickoff).accepted).toBe(true)
  return engine
}

describe('Physical opening kick-off with a legal 4-3-3 starting formation', () => {
  for (const takingClub of ['club_harbor', 'club_vale'] as const) {
    it('places both teams in legal halves and keeps opponents outside 9.15m: ' + takingClub, () => {
      const engine = createFoundationMatch(kickoffFixture(takingClub))
      const state = engine.getState()
      const { lengthM, widthM } = engine.getSetup().pitch
      const cx = lengthM / 2
      const cy = widthM / 2
      expect(state.players).toHaveLength(22)
      expect(state.kickoff?.teamId).toBe(takingClub)
      expect(state.kickoff?.phase).toBe('awaitingKick')
      expect(state.kickoff?.takenTick).toBeNull()
      expect(state.ball.position).toEqual({ xM: cx, yM: cy })
      expect(state.ball.velocity).toEqual({ xMps: 0, yMps: 0, zMps: 0 })
      expect(state.ball.controllerId).toBeNull()

      for (const p of state.players) {
        const home = p.clubId === engine.getSetup().clubs[0].id
        expect(home ? p.position.xM <= cx : p.position.xM >= cx).toBe(true)
        if (p.clubId !== takingClub) {
          expect(Math.hypot(p.position.xM - cx, p.position.yM - cy))
            .toBeGreaterThanOrEqual(9.15)
        }
        if (p.playerId !== state.kickoff?.kickerId) {
          expect(home ? p.position.xM < cx : p.position.xM > cx).toBe(true)
        }
      }
      const taker = state.players.find(p => p.playerId === state.kickoff?.kickerId)!
      const receiver = state.players.find(p => p.playerId === state.kickoff?.receiverId)!
      expect(Math.hypot(taker.position.xM - cx, taker.position.yM - cy))
        .toBeLessThan(1.05)
      expect(receiver.clubId).toBe(takingClub)
      expect((receiver.position.xM - cx) * (taker.position.xM - cx))
        .toBeGreaterThan(0)
      expect(receiver.position.xM).not.toBe(cx)
    })
  }

  it('does not allow AI to chase, press or carry before the physical kick', () => {
    const engine = createFoundationMatch(kickoffFixture())
    const start = engine.getState()
    engine.submitCommand({
      commandId: 'home-ai', teamId: 'club_harbor',
      type: 'setAutonomousTeam', enabled: true,
    })
    engine.submitCommand({
      commandId: 'away-ai', teamId: 'club_vale',
      type: 'setAutonomousTeam', enabled: true,
    })
    engine.advance(40)
    const state = engine.getState()
    expect(state.kickoff?.phase).toBe('awaitingKick')
    expect(state.ai.enabledTeams).toEqual([true, true])
    expect(state.ai.lastDecisionTick).toBe(-1)
    expect(state.players).toEqual(start.players)
    expect(state.ball).toEqual(start.ball)
    expect(state.automaticContactEvents).toHaveLength(0)
    expect(state.contactEvents).toHaveLength(0)
  })

  it('uses an actual footballer kicking a physical pass toward a teammate, not a teleport', () => {
    const engine = matchStarted()
    const atZero = engine.getState()
    const request = atZero.pendingCommands.find(c =>
      c.commandId === OPENING_KICKOFF_COMMAND_ID)
    expect(request?.type).toBe('attemptKick')
    if (request?.type !== 'attemptKick') throw new Error('Expected true kick command')
    expect(request.target.xM).toBeLessThan(atZero.ball.position.xM)
    expect(request.playerId).toBe(atZero.kickoff?.kickerId)
    expect(request.lift).toBe(0)

    engine.advance(1)
    const first = engine.getState()
    expect(first.ball.position).toEqual(atZero.ball.position)
    expect(first.players).toEqual(atZero.players)
    expect(first.ai.lastDecisionTick).toBe(-1)
    expect(first.contactEvents).toHaveLength(1)
    expect(first.contactEvents[0]).toMatchObject({
      commandId: OPENING_KICKOFF_COMMAND_ID,
      playerId: atZero.kickoff?.kickerId,
      outcome: 'kicked', kind: 'kick', drawUsed: 1,
    })
    expect(first.ball.velocity.xMps).toBeLessThan(-3)
    expect(first.ball.controllerId).toBeNull()
    expect(first.ball.lastTouchPlayerId).toBe(atZero.kickoff?.kickerId)
    expect(first.kickoff?.phase).toBe('awaitingKick')

    engine.advance(1)
    const second = engine.getState()
    expect(second.ball.position.xM).toBeLessThan(atZero.ball.position.xM - 0.05)
    expect(second.kickoff).toMatchObject({ phase: 'inPlay', takenTick: 2 })
    expect(second.players).toEqual(atZero.players)
    expect(second.ai.lastDecisionTick).toBe(-1)

    engine.advance(1)
    const third = engine.getState()
    expect(third.ai.lastDecisionTick).toBe(3)
    const receiver = third.players.find(p => p.playerId === third.kickoff?.receiverId)!
    expect(receiver.engagesBall).toBe(true)
    const taker = third.players.find(p => p.playerId === third.kickoff?.kickerId)!
    expect(taker.engagesBall).toBe(false)
    expect(third.teams.map(t => t.score)).toEqual([0, 0])
    expect(third.period).toBe('firstHalf')
    expect(third.periodTiming.firstHalfStartTick).toBe(2)
  })

  it('passes toward the correct half when Vale takes the kick', () => {
    const engine = matchStarted('club_vale')
    engine.advance(2)
    expect(engine.getState().kickoff?.phase).toBe('inPlay')
    expect(engine.getState().ball.position.xM)
      .toBeGreaterThan(engine.getSetup().pitch.lengthM / 2)
    expect(engine.getState().ball.lastTouchPlayerId)
      .toBe(engine.getState().kickoff?.kickerId)
  })

  it('keeps the original diagnostic-only fixture intact for previous milestones', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    const state = engine.getState()
    expect(state.kickoff).toBeNull()
    expect(state.players[9].position.xM).toBeCloseTo(76.65, 7)
    engine.advance(40)
    expect(engine.getState().players).toEqual(state.players)
    expect(engine.getState().ball).toEqual(state.ball)
  })

  it('replays kick-off states precisely across checkpoints and tick chunk sizes', () => {
    const engine = matchStarted()
    engine.advance(1)
    const justKicked = JSON.parse(JSON.stringify(engine.checkpoint()))
    const restored = restoreFoundationMatch(justKicked)
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
    engine.advance(39)
    restored.advance(2)
    restored.advance(37)
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
    expect(engine.getState().kickoff?.phase).toBe('inPlay')
  })

  it('rejects forged kickoff completion, changes to the taker and fake pass commands', () => {
    const engine = matchStarted()
    engine.advance(4)
    const cp = engine.checkpoint()
    const corrupt: ((data: any) => void)[] = [
      c => { c.state.kickoff.phase = 'awaitingKick' },
      c => { c.state.kickoff.takenTick = 100 },
      c => { c.state.kickoff.teamId = 'club_vale' },
      c => { c.state.kickoff.kickerId = c.state.kickoff.receiverId },
      c => { c.state.contactEvents[0].outcome = 'outOfReach' },
      c => { c.state.appliedCommands.find((x: any) =>
        x.commandId === OPENING_KICKOFF_COMMAND_ID).power = 0.9 },
      c => { c.state.appliedCommands.find((x: any) =>
        x.commandId === OPENING_KICKOFF_COMMAND_ID).target.xM = 75 },
      c => { c.checkpointVersion = 6 },
    ]
    for (const mutate of corrupt) {
      const modified = structuredClone(cp)
      mutate(modified)
      expect(() => restoreFoundationMatch(modified)).toThrow()
    }
  })

  it('rejects an unknown kickoff-taking team in fixture validation', () => {
    const invalid = kickoffFixture('unknown-team')
    expect(() => createFoundationMatch(invalid)).toThrow()
  })
})
