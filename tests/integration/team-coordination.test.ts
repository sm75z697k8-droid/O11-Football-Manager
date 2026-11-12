import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { openingKickoffPass } from '../../src/game/match/kickoff'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { predictBallAt, separationM } from '../../src/game/ai/coordination'

const kickoffEngine = (takingTeam = 'club_harbor') => {
  const fixture = { ...makeFictionalMatchSetup(),
    kickoff: { teamId: takingTeam } }
  const engine = createFoundationMatch(fixture)
  for (const club of fixture.clubs) {
    expect(engine.submitCommand({
      type: 'setAutonomousTeam', enabled: true,
      commandId: 'team-ai-' + club.id, teamId: club.id,
    }).accepted).toBe(true)
  }
  expect(engine.submitCommand(
    openingKickoffPass(engine.getState())).accepted).toBe(true)
  return engine
}

describe('Phase 6.3 coordinated opening and defensive transitions', () => {
  for (const teamId of ['club_harbor', 'club_vale']) {
    it('provides two actual nearby midfield outlets in a lawful opening: ' + teamId, () => {
      const engine = kickoffEngine(teamId)
      const s = engine.getState()
      const center = s.ball.position
      const mids = s.players.filter(p => p.clubId === teamId &&
        (p.formationSlot === 'RCM' || p.formationSlot === 'LCM'))
      expect(mids).toHaveLength(2)
      for (const p of mids) {
        expect(separationM(p.position, center)).toBeLessThan(8)
        expect(p.clubId).toBe(teamId)
      }
      expect(separationM(mids[0].position, mids[1].position))
        .toBeGreaterThan(6)
      expect(mids.some(p => p.playerId === s.kickoff?.receiverId)).toBe(true)
      expect(s.players.filter(p => p.clubId !== teamId)
        .every(p => separationM(p.position, center) >= 9.15)).toBe(true)
    })
  }

  it('selects the initial receiving midfielder by ability rather than a hardwired RCM', () => {
    const fixture = makeFictionalMatchSetup()
    const edited = structuredClone(fixture)
    const rcm = edited.teams[0].starters.find(p => p.slot === 'RCM')!.playerId
    const lcm = edited.teams[0].starters.find(p => p.slot === 'LCM')!.playerId
    for (const id of [rcm, lcm]) {
      const player = edited.players.find(p => p.id === id)!
      const abilities = player.abilities as unknown as {
        technical: { firstTouch: number; technique: number };
        mental: { anticipation: number };
      }
      abilities.technical.firstTouch = id === lcm ? 98 : 5
      abilities.technical.technique = id === lcm ? 98 : 5
      abilities.mental.anticipation = id === lcm ? 98 : 5
    }
    const game = createFoundationMatch({ ...edited,
      kickoff: { teamId: edited.clubs[0].id } })
    expect(game.getState().kickoff?.receiverId).toBe(lcm)
    expect(openingKickoffPass(game.getState()).target)
      .toEqual(game.getState().players.find(p => p.playerId === lcm)?.position)
  })

  it('keeps everyone in their starting position until physical kick-off movement', () => {
    const engine = kickoffEngine()
    const initial = engine.getState()
    engine.advance()
    expect(engine.getState().players).toEqual(initial.players)
    expect(engine.getState().ai.lastDecisionTick).toBe(-1)
    expect(engine.getState().contactEvents[0].outcome).toBe('kicked')
  })

  it('makes the physical intended recipient anticipate where the kicked ball will arrive', () => {
    const engine = kickoffEngine()
    engine.advance(3)
    const s = engine.getState()
    expect(s.kickoff?.phase).toBe('inPlay')
    const receiver = s.players.find(p => p.playerId === s.kickoff?.receiverId)!
    const plan = s.ai.decisionSnapshot.find(d => d.playerId === receiver.playerId)
    expect(plan?.action).toBe('receive')
    expect(plan?.engage).toBe(true)
    const predicted = predictBallAt(s.ball, .6).position
    expect(plan?.target.xM).toBeLessThan(52.5)
    expect(plan?.target.xM).toBeLessThan(s.ball.position.xM - .5)
    expect(separationM(plan!.target, predicted)).toBeLessThan(3.5)
    expect(s.ball.controllerId).toBeNull()
  })

  it('coordinates meaningful simultaneous support, pressing and cover after kick-off', () => {
    const engine = kickoffEngine()
    engine.advance(3)
    const s = engine.getState()
    const homeDecisions = s.ai.decisionSnapshot.filter(d => d.clubId === 'club_harbor')
    const awayDecisions = s.ai.decisionSnapshot.filter(d => d.clubId === 'club_vale')
    expect(homeDecisions).toHaveLength(11)
    expect(awayDecisions).toHaveLength(11)
    expect(homeDecisions.filter(d => d.action === 'receive')).toHaveLength(1)
    expect(homeDecisions.filter(d => d.action === 'support').length)
      .toBeGreaterThanOrEqual(6)
    expect(awayDecisions.filter(d => d.action === 'press')).toHaveLength(1)
    expect(awayDecisions.filter(d => d.action === 'cover')).toHaveLength(1)
    expect(awayDecisions.some(d => d.action === 'mark')).toBe(true)
    expect(homeDecisions.filter(d => d.engage)).toHaveLength(1)
    expect(awayDecisions.filter(d => d.engage)).toHaveLength(1)
  })

  it('records real interception of the opening pass, not a forced owner assignment', () => {
    const engine = kickoffEngine()
    const receiverId = engine.getState().kickoff!.receiverId
    engine.advance(65)
    const s = engine.getState()
    const contacts = s.automaticContactEvents.filter(event =>
      event.playerId === receiverId && event.kind === 'interception' &&
      event.outcome === 'intercepted')
    expect(contacts.length).toBeGreaterThan(0)
    expect(s.contactEvents[0].kind).toBe('kick')
    expect(s.contactEvents[0].outcome).toBe('kicked')
    expect(s.kickoff?.phase).toBe('inPlay')
  })

  it('replays the coordinated kick-off deterministically across checkpoints', () => {
    const original = kickoffEngine()
    original.advance(36)
    const copied = restoreFoundationMatch(
      JSON.parse(JSON.stringify(original.checkpoint())))
    original.advance(180)
    copied.advance(40)
    copied.advance(140)
    expect(copied.checkpoint()).toEqual(original.checkpoint())
    const actions = new Set(original.getState().ai.decisionSnapshot.map(d => d.action))
    expect(actions.size).toBeGreaterThan(2)
  })

  it('the actual landscape match session retains authoritative team coordination', () => {
    const session = new MatchViewerSession()
    session.advance(3)
    expect(session.state.ai.decisionSnapshot).toHaveLength(22)
    expect(session.state.ai.decisionSnapshot.some(d => d.action === 'receive')).toBe(true)
    expect(session.state.ai.decisionSnapshot.some(d => d.action === 'support')).toBe(true)
    expect(session.state.ai.decisionSnapshot.some(d => d.action === 'cover')).toBe(true)
    expect(session.checkpoint().state).toEqual(session.state)
  })
})
