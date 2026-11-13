import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch } from '../../src/game/match/engine'
import { planTeamDecisions } from '../../src/game/ai/decisions'
import { planHeldGoalkeeperShape } from '../../src/game/ai/goalkeeper-possession-shape'
import { chooseGoalkeeperThrow } from '../../src/game/ai/goalkeeper-distribution'
import { activeGoalkeeperCatch } from '../../src/game/physics/goalkeeper-handling'
import { resolveAutomaticBallContact } from '../../src/game/physics/automatic-contact'
import { MatchViewerSession } from '../../src/game/viewer/session'
import type { MatchState } from '../../src/game/match/state'

const separation = (a: {xM:number;yM:number}, b:{xM:number;yM:number}) =>
  Math.hypot(a.xM-b.xM, a.yM-b.yM)

/** Make a truly swept and attributable opposing shot catch on either end. */
function caughtShot(side: 0 | 1) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const club = setup.clubs[side].id
  const opponent = setup.clubs[1-side].id
  const direction: 1|-1 = side === 0 ? 1 : -1
  const keeper = initial.players.find(p =>
    p.clubId === club && p.formationSlot === 'GK')!
  const striker = initial.players.find(p =>
    p.clubId === opponent && p.formationSlot === 'ST')!
  const keeperX = side === 0 ? 4.7 : setup.pitch.lengthM - 4.7
  const players = initial.players.map(p => p.playerId === keeper.playerId
    ? {...p,position:{xM:keeperX,yM:setup.pitch.widthM/2},
        velocity:{xMps:0,yMps:0},engagesBall:true}
    : {...p,engagesBall:false})
  const before:MatchState = {
    ...initial, kickoff:null, clock:{...initial.clock,tick:23},
    players,ai:{...initial.ai,enabledTeams:[true,true],lastDecisionTick:22},
    ball:{...initial.ball,
      position:{xM:keeperX+direction*1.05,yM:setup.pitch.widthM/2},
      heightM:1,velocity:{xMps:-direction*8,yMps:0,zMps:0},
      controllerId:null,controlOffset:null,outsidePitch:false,
      lastTouchPlayerId:striker.playerId},
    contactEvents:[{
      commandId:'ai-shot-held-shape-test',playerId:striker.playerId,
      kind:'kick',outcome:'kicked',tick:22,drawUsed:1}],
  }
  const after:MatchState={
    ...before, clock:{...before.clock,tick:24},
    ball:{...before.ball,
      position:{xM:keeperX+direction*.62,yM:setup.pitch.widthM/2}},
  }
  const held=resolveAutomaticBallContact(before,after,setup)
  expect(held.automaticContactEvents.at(-1)?.outcome).toBe('caught')
  expect(held.ball.controllerId).toBe(keeper.playerId)
  expect(activeGoalkeeperCatch(held)).not.toBeNull()
  return {setup,held,keeper,club,opponent,before}
}

describe('Phase 6.9K — real goalkeeper hand-possession shape',()=>{
  for (const side of [0,1] as const) {
    it(`spreads the catching goalkeeper's teammates in real outlets from end ${side}`,()=>{
      const {setup,held,keeper,club,before}=caughtShot(side)
      const raw=JSON.stringify(held)
      const decisions=planTeamDecisions(held,setup)
      expect(decisions).toHaveLength(22)
      const own=decisions.filter(d=>d.clubId===club)
      expect(own).toHaveLength(11)
      const keeperDecision=own.find(d=>d.playerId===keeper.playerId)!
      expect(keeperDecision.action).toBe('shape')
      expect(keeperDecision.engage).toBe(false)
      expect(keeperDecision.target).toEqual(keeper.position)
      const outlets=own.filter(d=>d.playerId!==keeper.playerId)
      expect(outlets).toHaveLength(10)
      expect(outlets.every(d=>d.action==='support' && !d.engage))
        .toBe(true)
      expect(outlets.every(d=>
        separation(d.target,keeper.position)>=12)).toBe(true)
      const direction=side===0?1:-1
      const backs=outlets.filter(d=>{
        const slot=held.players.find(p=>p.playerId===d.playerId)!.formationSlot
        return slot==='RCB'||slot==='LCB'
      })
      expect(backs).toHaveLength(2)
      expect(separation(backs[0].target,backs[1].target))
        .toBeGreaterThan(12)
      expect(backs.every(d=> (d.target.xM-keeper.position.xM)*direction>12))
        .toBe(true)
      const mids=outlets.filter(d=>{
        const slot=held.players.find(p=>p.playerId===d.playerId)!.formationSlot
        return slot==='DM'||slot==='RCM'||slot==='LCM'
      })
      expect(mids.every(d=>
        (d.target.xM-keeper.position.xM)*direction>24)).toBe(true)
      // Planner is a pure set of movement intentions, NOT a new ball
      // touch, scripted throw or invented keeper action.
      expect(held.contactEvents).toEqual(before.contactEvents)
      expect(held.automaticContactEvents).toHaveLength(1)
      expect(JSON.stringify(held)).toBe(raw)
      expect(planTeamDecisions(held,setup)).toEqual(decisions)
    })

    it(`makes the opposition screen outlets rather than chase keeper from end ${side}`,()=>{
      const {setup,held,keeper,opponent}=caughtShot(side)
      const decisions=planTeamDecisions(held,setup)
      const defending=decisions.filter(d=>d.clubId===opponent)
      expect(defending).toHaveLength(11)
      expect(defending.every(d=>!d.engage)).toBe(true)
      expect(defending.every(d=>d.action!=='press'&&d.action!=='pursue'))
        .toBe(true)
      expect(defending.every(d=>separation(d.target,keeper.position)>10))
        .toBe(true)
      const standardMarks=defending.filter(d=>d.action==='mark')
      expect(standardMarks.length).toBeLessThanOrEqual(1)
      const high:MatchState={...held,teams:[
        {...held.teams[0],pressingIntensity:held.teams[0].clubId===opponent?'high':'standard'},
        {...held.teams[1],pressingIntensity:held.teams[1].clubId===opponent?'high':'standard'},
      ]}
      const highMarks=planTeamDecisions(high,setup)
        .filter(d=>d.clubId===opponent&&d.action==='mark')
      expect(highMarks.length).toBeLessThanOrEqual(2)
      const low:MatchState={...held,teams:[
        {...held.teams[0],pressingIntensity:held.teams[0].clubId===opponent?'low':'standard'},
        {...held.teams[1],pressingIntensity:held.teams[1].clubId===opponent?'low':'standard'},
      ]}
      const lowBlock=planTeamDecisions(low,setup)
        .filter(d=>d.clubId===opponent)
      expect(lowBlock.every(d=>d.action!=='mark')).toBe(true)
      expect(lowBlock.every(d=>!d.engage)).toBe(true)
    })

    it(`only activates on a genuine held catch and turns off after ball release from end ${side}`,()=>{
      const {setup,held,club,opponent,keeper}=caughtShot(side)
      expect(planHeldGoalkeeperShape(held,setup,club)?.size).toBe(11)
      expect(planHeldGoalkeeperShape(held,setup,opponent)?.size).toBe(11)
      // The existing keeper throw still requires its genuine minimum
      // hold and real distribution. Tactical shape can't mint a throw.
      expect(chooseGoalkeeperThrow(held,setup)).toBeNull()
      const released:MatchState={...held,
        ball:{...held.ball,controllerId:null,controlOffset:null,
          lastTouchPlayerId:keeper.playerId},
      }
      expect(planHeldGoalkeeperShape(released,setup,club)).toBeNull()
      expect(planHeldGoalkeeperShape(released,setup,opponent)).toBeNull()
      const feet:MatchState={...held,
        ball:{...held.ball,heightM:.11},
      }
      expect(planHeldGoalkeeperShape(feet,setup,club)).toBeNull()
    })
  }

  it('updates both autonomous teams on the next real tick after a live catch',()=>{
    const session=new MatchViewerSession(42)
    for(let i=0;i<1100 && !session.state.ball.outsidePitch &&
        !session.state.automaticContactEvents.some(e=>e.outcome==='caught');i++) {
      session.advance(1)
    }
    const state=session.state
    const actualCatch=state.automaticContactEvents.find(e=>e.outcome==='caught')
    expect(actualCatch).toBeDefined()
    const keeper=state.players.find(p=>p.playerId===actualCatch?.playerId)!
    expect(keeper).toBeDefined()
    session.advance(1)
    const next=session.state
    expect(next.ball.controllerId).toBe(keeper.playerId)
    expect(next.ai.enabledTeams).toEqual([true,true])
    expect(next.ai.decisionSnapshot).toHaveLength(22)
    const catchShape=next.ai.decisionSnapshot.filter(d=>
      d.playerId!==keeper.playerId)
    expect(catchShape.every(d=>d.action!=='press'&&d.action!=='pursue'))
      .toBe(true)
    expect(catchShape.every(d=>!d.engage)).toBe(true)
    expect(next.ball.heightM).toBeGreaterThan(.8)
    expect(next.goalEvents).toHaveLength(0)
  })
})
