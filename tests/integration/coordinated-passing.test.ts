import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { activePassIntent } from '../../src/game/ai/pass-coordination'
import { evaluateOnBallChoice } from '../../src/game/ai/possession'

function reachFirstAutonomousPass() {
  const engine = createFoundationMatch(makeFictionalMatchSetup())
  const setup = engine.getSetup()
  for (const club of setup.clubs) {
    expect(engine.submitCommand({
      commandId: 'enabled-' + club.id,
      teamId: club.id, enabled: true,
      type: 'setAutonomousTeam',
    }).accepted).toBe(true)
  }
  for (let i = 0; i < 1000; i += 1) {
    engine.advance()
    if (engine.getState().ai.passIntent) return engine
  }
  throw new Error('AI failed to choose any contextual physical pass in 1000 ticks')
}

describe('Phase 6.3.1 authoritative pass-receiver coordination', () => {
  it('stores a real teammate as the intended receiver of a physical kick', () => {
    const engine = reachFirstAutonomousPass()
    const s = engine.getState()
    const intent = s.ai.passIntent!
    const passer = s.players.find(p => p.playerId === intent.passerId)!
    const receiver = s.players.find(p => p.playerId === intent.receiverId)!
    const pending = s.pendingCommands.find(c => c.commandId === intent.commandId)
    expect(intent.commandId).toMatch(/^ai-pass-/)
    expect(intent.teamId).toBe(passer.clubId)
    expect(intent.teamId).toBe(receiver.clubId)
    expect(passer.playerId).not.toBe(receiver.playerId)
    expect(pending?.type).toBe('attemptKick')
    if (pending?.type !== 'attemptKick') throw new Error('No physical kick')
    expect(pending.target).toEqual(intent.target)
    expect(s.ai.lastPassTick).toBe(intent.requestedTick)
    expect(receiver.engagesBall).toBe(true)
    expect(receiver.intention.kind).toBe('moveToPoint')
    expect(s.ball.controllerId).toBe(passer.playerId)
    expect(s.contactEvents.some(e => e.commandId === intent.commandId)).toBe(false)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint()).toEqual(engine.checkpoint())
  })

  it('receives the actual contact outcome rather than crediting a predetermined pass', () => {
    const engine = reachFirstAutonomousPass()
    const intended = engine.getState().ai.passIntent!
    engine.advance(1)
    const s = engine.getState()
    const result = s.contactEvents.find(e => e.commandId === intended.commandId)
    expect(result).toBeDefined()
    expect(result?.kind).toBe('kick')
    // The chosen pass has not been magically awarded to the teammate.
    expect(s.ball.controllerId).not.toBe(intended.receiverId)
    if (result?.outcome === 'kicked') {
      expect(s.ball.lastTouchPlayerId).toBe(intended.passerId)
      expect(Math.hypot(s.ball.velocity.xMps, s.ball.velocity.yMps)).toBeGreaterThan(0)
      engine.advance(1)
      const next = engine.getState()
      if (activePassIntent(next)) {
        const receiver = next.players.find(p => p.playerId === intended.receiverId)!
        expect(receiver.engagesBall).toBe(true)
        expect(receiver.intention.kind).toBe('moveToPoint')
      }
    } else {
      engine.advance(1)
      expect(engine.getState().ai.passIntent).toBeNull()
    }
  })

  it('round-trips a pending pass and deterministic replay across tick chunking', () => {
    const engine = reachFirstAutonomousPass()
    const cp = engine.checkpoint()
    const resumed = restoreFoundationMatch(JSON.parse(JSON.stringify(cp)))
    engine.advance(42)
    resumed.advance(17)
    resumed.advance(25)
    expect(resumed.checkpoint()).toEqual(engine.checkpoint())
    expect(engine.getState().teams.map(t => t.score)).toEqual([0, 0])
    expect(engine.getState().period).toBe('notStarted')
  })

  it('rejects forged receiver identities and kick targets at checkpoint restoration', () => {
    const engine = reachFirstAutonomousPass()
    const original = engine.checkpoint()
    const changes: ((cp: any) => void)[] = [
      cp => { cp.state.ai.passIntent.receiverId = 'nonexistent' },
      cp => { cp.state.ai.passIntent.receiverId = cp.state.players.find(
        (p: any) => p.clubId !== cp.state.ai.passIntent.teamId).playerId },
      cp => { cp.state.ai.passIntent.teamId = 'unknown-club' },
      cp => { cp.state.ai.passIntent.target.xM += 1 },
      cp => { cp.state.ai.passIntent.requestedTick = -8 },
      cp => { cp.state.ai.passIntent.commandId = 'fake-kick' },
      cp => { cp.checkpointVersion = 7 },
    ]
    for (const change of changes) {
      const tampered = structuredClone(original)
      change(tampered)
      expect(() => restoreFoundationMatch(tampered)).toThrow()
    }
  })

  it('keeps decision values repeatable and does not overwrite current possession', () => {
    const engine = reachFirstAutonomousPass()
    const s = engine.getState()
    const before = JSON.stringify(s)
    const a = evaluateOnBallChoice(s, engine.getSetup())
    const b = evaluateOnBallChoice(s, engine.getSetup())
    expect(a).toEqual(b)
    expect(JSON.stringify(s)).toBe(before)
    expect(s.ai.passIntent?.receiverId).not.toBe(s.ball.controllerId)
  })
})
