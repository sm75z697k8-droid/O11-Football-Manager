import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { AI_DECISION_PERIOD_TICKS, choosePossessionRelease, planTeamDecisions } from '../../src/game/ai/decisions'
import type { MatchState } from '../../src/game/match/state'

const setup = makeFictionalMatchSetup
const toggle = (teamId = 'club_harbor', enabled = true, id = 'enable') => ({
  commandId: id, teamId, type: 'setAutonomousTeam' as const, enabled,
})

describe('Phase 5 opt-in tactical decision system', () => {
  it('leaves both teams perfectly stationary when autonomy is disabled', () => {
    const engine = createFoundationMatch(setup())
    const original = engine.getState()
    engine.advance(1000)
    const state = engine.getState()
    expect(state.players).toEqual(original.players)
    expect(state.ball).toEqual(original.ball)
    expect(state.ai).toEqual(original.ai)
    expect(state.ai.enabledTeams).toEqual([false, false])
    expect(state.ai.decisionSnapshot).toEqual([])
  })

  it('starts deciding on the next tick for the enabled club only', () => {
    const engine = createFoundationMatch(setup())
    const initial = engine.getState()
    expect(engine.submitCommand(toggle()).accepted).toBe(true)
    expect(engine.getState()).toMatchObject({
      ai: { enabledTeams: [false, false], lastDecisionTick: -1 },
    })
    engine.advance()
    const state = engine.getState()
    expect(state.ai.enabledTeams).toEqual([true, false])
    expect(state.ai.lastDecisionTick).toBe(1)
    expect(state.ai.decisionSnapshot).toHaveLength(11)
    expect(state.ai.decisionSnapshot.every(d => d.clubId === 'club_harbor')).toBe(true)
    expect(state.players.slice(11)).toEqual(initial.players.slice(11))
    expect(state.players.some((p, i) => i < 11 &&
      p.intention.kind === 'moveToPoint')).toBe(true)
    expect(state.teams.map(t => t.score)).toEqual([0, 0])
  })

  it('updates decisions at a fixed interval while movement updates every tick', () => {
    const engine = createFoundationMatch(setup())
    engine.submitCommand(toggle())
    engine.advance()
    const initial = engine.getState()
    engine.advance(AI_DECISION_PERIOD_TICKS - 1)
    expect(engine.getState().ai.lastDecisionTick).toBe(1)
    expect(engine.getState().players.some((p, i) =>
      i < 11 && p.position.xM !== initial.players[i].position.xM)).toBe(true)
    engine.advance()
    expect(engine.getState().ai.lastDecisionTick).toBe(1 + AI_DECISION_PERIOD_TICKS)
  })

  it('rejects unknown, forged and malformed autonomy instructions', () => {
    const engine = createFoundationMatch(setup())
    const before = engine.checkpoint()
    for (const command of [
      toggle('other', true, 'unknown'),
      { ...toggle('club_harbor', true, 'string'), enabled: 'true' },
      { ...toggle('club_harbor', true, 'extra'), extra: 'yes' },
      { ...toggle('club_harbor', true, 'null'), enabled: null },
    ]) expect(engine.submitCommand(command).accepted).toBe(false)
    expect(engine.checkpoint()).toEqual(before)
  })

  it('allows one AI team independently, then disables it without disabling the opponent', () => {
    const engine = createFoundationMatch(setup())
    engine.submitCommand(toggle('club_harbor', true, 'home'))
    engine.submitCommand(toggle('club_vale', true, 'away'))
    engine.advance(30)
    expect(engine.getState().ai.enabledTeams).toEqual([true, true])
    expect(engine.getState().ai.decisionSnapshot).toHaveLength(22)
    engine.submitCommand(toggle('club_harbor', false, 'disable-home'))
    engine.advance()
    const result = engine.getState()
    expect(result.ai.enabledTeams).toEqual([false, true])
    expect(result.ai.decisionSnapshot.every(d => d.clubId === 'club_vale')).toBe(true)
    expect(restoreFoundationMatch(engine.checkpoint()).checkpoint()).toEqual(engine.checkpoint())
  })

  it('pressing intensity changes how many defenders pursue a possessed ball', () => {
    const engine = createFoundationMatch(setup())
    const baseline = engine.getState()
    const away = baseline.players.find(p => p.clubId === 'club_vale' && p.formationSlot === 'ST')!
    const ball = { ...baseline.ball, controllerId: away.playerId,
      lastTouchPlayerId: away.playerId, controlOffset: { xM: 0, yM: 0 },
      position: { ...away.position } }
    const state: MatchState = {
      ...baseline, ball, ai: { ...baseline.ai, enabledTeams: [true, false] },
    }
    const high: MatchState = { ...state,
      teams: [
        { ...state.teams[0], pressingIntensity: 'high' },
        state.teams[1],
      ],
    }
    const low: MatchState = { ...state,
      teams: [
        { ...state.teams[0], pressingIntensity: 'low' },
        state.teams[1],
      ],
    }
    const engaged = (s: MatchState) => planTeamDecisions(s, setup())
      .filter(d => d.engage).length
    expect(engaged(high)).toBe(2)
    expect(engaged(low)).toBeLessThan(2)
  })

  it('moves both teams toward genuine physical opportunities without fabricated results', () => {
    const engine = createFoundationMatch(setup())
    engine.submitCommand(toggle('club_harbor', true, 'home'))
    engine.submitCommand(toggle('club_vale', true, 'away'))
    engine.advance(300)
    const state = engine.getState()
    expect(state.players.some((p) =>
      Math.hypot(p.position.xM -
          state.ai.formationPositions[p.playerId].xM,
        p.position.yM - state.ai.formationPositions[p.playerId].yM) > 1)).toBe(true)
    expect(state.automaticContactEvents.length).toBeGreaterThan(0)
    expect(state.teams.map(t => t.score)).toEqual([0, 0])
    expect(state.period).toBe('notStarted')
    expect(state.players.every(p =>
      p.position.xM >= 0 && p.position.xM <= 105 &&
      p.position.yM >= 0 && p.position.yM <= 68)).toBe(true)
  })

  it('selects a real nearby teammate as an attempted pass option under pressure', () => {
    const engine = createFoundationMatch(setup())
    const snapshot = engine.getState()
    const owner = snapshot.players[9]
    const colleague = snapshot.players[8]
    const opponent = snapshot.players[20]
    const players = snapshot.players.map(p =>
      p.playerId === colleague.playerId ? {
        ...p, position: { xM: owner.position.xM + 12, yM: owner.position.yM },
      } : p.playerId === opponent.playerId ? {
        ...p, position: { xM: owner.position.xM + 2, yM: owner.position.yM },
      } : p)
    const state: MatchState = {
      ...snapshot,
      players,
      ai: { ...snapshot.ai, enabledTeams: [true, false] },
      ball: {
        ...snapshot.ball, controllerId: owner.playerId,
        lastTouchPlayerId: owner.playerId,
        controlOffset: { xM: 0, yM: 0 },
        position: { ...owner.position },
      },
    }
    const pass = choosePossessionRelease(state, setup())
    expect(pass?.teamId).toBe('club_harbor')
    expect(pass?.playerId).toBe(owner.playerId)
    // A pressured footballer may sensibly recycle backwards or sideways:
    // the target must match a real teammate, not a forced forward vector.
    expect(pass).not.toBeNull()
    if (!pass) return
    expect(players.some(player =>
      player.clubId === owner.clubId &&
      player.playerId !== owner.playerId &&
      Math.hypot(player.position.xM - pass.target.xM,
        player.position.yM - pass.target.yM) <= 2,
    )).toBe(true)
    expect(pass.power).toBeGreaterThan(0)
  })

  it('replays autonomous motion, contact and attempted releases byte-for-byte', () => {
    const left = createFoundationMatch(setup())
    left.submitCommand(toggle('club_harbor', true, 'home'))
    left.submitCommand(toggle('club_vale', true, 'away'))
    left.advance(235)
    const checkpoint = JSON.parse(JSON.stringify(left.checkpoint()))
    const right = restoreFoundationMatch(checkpoint)
    left.advance(415)
    for (const steps of [1, 7, 23, 54, 130, 200]) right.advance(steps)
    expect(JSON.stringify(right.checkpoint())).toBe(JSON.stringify(left.checkpoint()))
    expect(left.getState().ai.lastDecisionTick).toBeGreaterThan(0)
  })

  it('protects AI config, target bounds, decision identity and checkpoint versions', () => {
    const engine = createFoundationMatch(setup())
    engine.submitCommand(toggle())
    engine.advance(38)
    const original = engine.checkpoint()
    const edits: ((copy: any) => void)[] = [
      c => { c.state.ai.enabledTeams[0] = false },
      c => { c.state.ai.decisionSnapshot[0].playerId = 'forged' },
      c => { c.state.ai.decisionSnapshot[0].target.xM = 900 },
      c => { c.state.ai.lastDecisionTick = 999999 },
      c => { c.state.ai.formationPositions['harbor_player_01'].xM = 3 },
      c => { c.state.ai.lastPassTick = 100 },
      c => { c.state.players[12].position.xM = 0 },
      c => { c.checkpointVersion = 5 },
    ]
    for (const edit of edits) {
      const cp = structuredClone(original)
      edit(cp)
      expect(() => restoreFoundationMatch(cp)).toThrow()
    }
  })
})
