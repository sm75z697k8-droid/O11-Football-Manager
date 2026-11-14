import { describe, expect, it } from 'vitest'
import type { MatchSetup } from '../../src/game/model/match'
import type { MatchState } from '../../src/game/match/state'
import { createFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  defensiveRecoveryTarget, planDefensiveResponsibilities,
} from '../../src/game/ai/defensive-shape'
import { planCentralPressing } from '../../src/game/ai/central-pressing'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { maintainWidePassFlightScreen } from '../../src/game/ai/pressing-traps'
import { projectPlayerToward } from '../../src/game/physics/locomotion'

/**
 * Synthetic tactical layouts, mirrored in both attacking directions.
 * None of these tests pretends an interception or press win occurred.
 */
function centralScene(side: 0 | 1) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const team = initial.teams[side]
  const opponent = initial.teams[1 - side]
  const mirrored = (xM: number, yM: number) => side === 0
    ? { xM, yM }
    : { xM: setup.pitch.lengthM - xM,
        yM: setup.pitch.widthM - yM }
  const get = (clubId: string, slot: string) =>
    initial.players.find(p =>
      p.clubId === clubId && p.formationSlot === slot)!
  const ball = mirrored(60, 34)
  const carrier = get(opponent.clubId, 'DM')
  const forward = get(opponent.clubId, 'ST')
  const alternative = get(opponent.clubId, 'LCM')
  const presser = get(team.clubId, 'ST')
  const cover = get(team.clubId, 'DM')
  const screener = get(team.clubId, 'RCM')
  const positions = new Map([
    [carrier.playerId, ball],
    [forward.playerId, mirrored(42, 29)],
    [alternative.playerId, mirrored(47, 46)],
    [presser.playerId, mirrored(56, 34)],
    [cover.playerId, mirrored(52, 34)],
    [screener.playerId, mirrored(51, 43)],
  ])
  const players = initial.players.map(p => ({
    ...p,
    position: positions.get(p.playerId) ??
      (p.clubId === team.clubId
        ? mirrored(15, 8) : mirrored(95, 60)),
    velocity: { xMps: 0, yMps: 0 },
  }))
  const state: MatchState = {
    ...initial,
    kickoff: null,
    clock: { ...initial.clock, tick: 123 },
    players,
    teams: [
      { ...initial.teams[0],
        pressingIntensity: side === 0 ? 'standard' :
          initial.teams[0].pressingIntensity },
      { ...initial.teams[1],
        pressingIntensity: side === 1 ? 'standard' :
          initial.teams[1].pressingIntensity },
    ],
    ball: {
      ...initial.ball,
      position: ball,
      heightM: .11,
      outsidePitch: false,
      controllerId: carrier.playerId,
      lastTouchPlayerId: carrier.playerId,
      controlOffset: { xM: 0, yM: 0 },
      velocity: { xMps: 0, yMps: 0, zMps: 0 },
    },
    contactEvents: [{
      commandId: 'test-recent-control',
      playerId: carrier.playerId,
      tick: 120,
      kind: 'control',
      outcome: 'controlled',
      drawUsed: 0,
    }],
    ai: { ...initial.ai, enabledTeams: [true, true],
      decisionSnapshot: [] },
  }
  const blocks = new Map(players.map(p => [
    p.playerId,
    defensiveRecoveryTarget(
      p, state.ai.formationPositions[p.playerId], ball,
      state.teams[side], setup),
  ] as const))
  return {
    setup, state, team: state.teams[side],
    ball, carrier, forward, alternative, presser, cover, screener,
    blocks, mirrored,
  }
}

describe('PRS-S1.2 — central pressing cover shadows', () => {
  for (const side of [0, 1] as const) {
    it(`cooperatively denies two real forward lanes and preserves cover, side ${side}`, () => {
      const s = centralScene(side)
      const plan = planCentralPressing(
        s.state, s.setup, s.team, s.ball,
        [s.presser], s.cover, s.blocks)
      expect(plan).not.toBeNull()
      expect(plan!.shadowedOutletId).toBe(s.forward.playerId)
      expect(plan!.screenerId).toBe(s.screener.playerId)
      expect(plan!.screenedOutletId).toBe(s.alternative.playerId)
      const assigns = planDefensiveResponsibilities(
        s.state, s.setup, s.team, s.ball)
      expect(assigns.get(s.presser.playerId)?.action).toBe('press')
      expect(assigns.get(s.presser.playerId)?.engage).toBe(true)
      expect(assigns.get(s.cover.playerId)?.action).toBe('cover')
      const screen = assigns.get(s.screener.playerId)!
      expect(screen.action).toBe('screen')
      expect(screen.engage).toBe(false)
      expect(screen.target).toEqual(plan?.screenTarget)
      // The secondary screener is physically ON the alternative's lane.
      const alt = s.state.players.find(p =>
        p.playerId === s.alternative.playerId)!
      const dx = alt.position.xM - s.ball.xM
      const dy = alt.position.yM - s.ball.yM
      const px = screen.target.xM - s.ball.xM
      const py = screen.target.yM - s.ball.yM
      expect(Math.abs(dx * py - dy * px) / Math.hypot(dx, dy))
        .toBeLessThan(1e-6)
      // The main presser adjusts TOWARD the dangerous forward lane.
      const signed = side === 0 ? 1 : -1
      expect((plan!.approachTarget.yM - s.ball.yM) * signed)
        .toBeLessThan(-.10)
      const decisions = planTeamDecisions(s.state, s.setup)
      expect(decisions.filter(d=>d.clubId===s.team.clubId &&
        (d.action==='press'||d.action==='jockey')).length)
        .toBeLessThanOrEqual(1)
      expect(decisions.find(d=>d.playerId===s.screener.playerId)?.target)
        .toEqual(screen.target)
      const physical = s.state.players.find(p =>
        p.playerId===s.screener.playerId)!
      const definition=s.setup.players.find(p=>
        p.id===physical.playerId)!
      const moved=projectPlayerToward(
        physical,definition,screen.target,s.setup.pitch,s.state.clock.tick+1)
      expect(Math.hypot(moved.position.xM-physical.position.xM,
        moved.position.yM-physical.position.yM)).toBeLessThan(.35)
      expect(s.state.automaticContactEvents).toHaveLength(0)
    })

    it(`switches primary presser when a different opponent receives centrally, side ${side}`, () => {
      const s=centralScene(side)
      const previous=planTeamDecisions(s.state,s.setup)
      const newBall=s.state.players.find(p=>
        p.playerId===s.alternative.playerId)!.position
      const moved:MatchState={
        ...s.state,
        clock:{...s.state.clock,tick:128},
        ball:{
          ...s.state.ball,position:newBall,
          controllerId:s.alternative.playerId,
          lastTouchPlayerId:s.alternative.playerId,
        },
        contactEvents:[...s.state.contactEvents,{
          commandId:'test-new-reception',tick:127,
          playerId:s.alternative.playerId,
          kind:'control',outcome:'controlled',drawUsed:0,
        }],
        ai:{...s.state.ai,decisionSnapshot:previous},
      }
      const next=planDefensiveResponsibilities(
        moved,s.setup,s.team,newBall)
      expect(next.get(s.screener.playerId)?.action).toBe('press')
      expect(next.get(s.presser.playerId)?.action).not.toBe('press')
      expect(next.get(s.presser.playerId)?.action).not.toBe('screen')
      const decisions=planTeamDecisions(moved,s.setup)
      expect(decisions.find(d=>d.playerId===s.screener.playerId)?.action)
        .toBe('press')
    })

    it(`does not produce a central trap without a forward outlet, side ${side}`, () => {
      const s=centralScene(side)
      const moved:MatchState={
        ...s.state,
        players:s.state.players.map(p=>
          p.playerId===s.forward.playerId ||
          p.playerId===s.alternative.playerId
            ? {...p,position:s.mirrored(95,60)} : p),
      }
      expect(planCentralPressing(
        moved,s.setup,s.team,s.ball,[s.presser],s.cover,s.blocks))
        .toBeNull()
      const responsibilities=planDefensiveResponsibilities(
        moved,s.setup,s.team,s.ball)
      expect(responsibilities.get(s.screener.playerId)?.action)
        .not.toBe('screen')
    })

    it(`rejects central coordination when the defensive cover is absent, side ${side}`, () => {
      const s=centralScene(side)
      expect(planCentralPressing(
        s.state,s.setup,s.team,s.ball,[s.presser],null,s.blocks))
        .toBeNull()
      expect(planCentralPressing(
        s.state,s.setup,s.team,s.ball,[s.presser],
        {...s.cover,position:s.mirrored(15,8)},s.blocks))
        .toBeNull()
    })

    it(`keeps central cover shadows separate from wide and low pressing, side ${side}`, () => {
      const s=centralScene(side)
      expect(planCentralPressing(
        s.state,s.setup,s.team,s.mirrored(60,5),
        [s.presser],s.cover,s.blocks)).toBeNull()
      const lowTeam={...s.team,pressingIntensity:'low' as const}
      expect(planCentralPressing(
        s.state,s.setup,lowTeam,s.ball,
        [s.presser],s.cover,s.blocks)).toBeNull()
    })

    it(`grades approach accuracy by pressing intelligence, side ${side}`, () => {
      const s=centralScene(side)
      function rated(rating:number):MatchSetup {
        return {...s.setup,players:s.setup.players.map(p=>
          p.id!==s.presser.playerId?p:{
            ...p,
            abilities:{...p.abilities,mental:{
              ...p.abilities.mental,
              anticipation:rating,decisions:rating,
              defensivePositioning:rating,
            }},
          })}
      }
      const novice=planCentralPressing(
        s.state,rated(10),s.team,s.ball,[s.presser],s.cover,s.blocks)!
      const expert=planCentralPressing(
        s.state,rated(99),s.team,s.ball,[s.presser],s.cover,s.blocks)!
      expect(Math.abs(expert.approachTarget.yM-s.ball.yM))
        .toBeGreaterThan(Math.abs(novice.approachTarget.yM-s.ball.yM))
    })

    it(`keeps only genuinely kicked central passes eligible for physical interception, side ${side}`, () => {
      const s=centralScene(side)
      const snapshot=planTeamDecisions(s.state,s.setup)
      const mark=snapshot.find(d=>d.playerId===s.screener.playerId)!
      expect(mark.action).toBe('screen')
      expect(mark.engage).toBe(false)
      const velocity=side===0
        ? {xMps:-10,yMps:9,zMps:0}
        : {xMps:10,yMps:-9,zMps:0}
      const inFlight:MatchState={
        ...s.state,
        clock:{...s.state.clock,tick:127},
        ball:{
          ...s.state.ball,position:s.mirrored(58,36),
          controllerId:null,controlOffset:null,velocity,
        },
        contactEvents:[...s.state.contactEvents,{
          commandId:'test-real-kick',playerId:s.carrier.playerId,
          tick:126,kind:'kick',outcome:'kicked',drawUsed:1,
        }],
        ai:{...s.state.ai,decisionSnapshot:snapshot},
      }
      expect(maintainWidePassFlightScreen(inFlight,s.team)
        ?.screenerId).toBe(s.screener.playerId)
      const decisions=planTeamDecisions(inFlight,s.setup)
      const screen=decisions.find(d=>d.playerId===s.screener.playerId)!
      expect(screen.action).toBe('screen')
      expect(screen.engage).toBe(true)
      expect(inFlight.automaticContactEvents).toHaveLength(0)
    })
  }
})
