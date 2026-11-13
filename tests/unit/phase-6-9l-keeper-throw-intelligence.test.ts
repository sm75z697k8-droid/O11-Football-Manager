import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { resolveAutomaticBallContact } from '../../src/game/physics/automatic-contact'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { GOALKEEPER_HAND_HEIGHT_M, goalkeeperThrowVelocity } from '../../src/game/physics/goalkeeper-handling'
import {
  assessGoalkeeperThrowOptions, chooseGoalkeeperThrow,
} from '../../src/game/ai/goalkeeper-distribution'
import { previewPhysicalGoalkeeperThrow } from '../../src/game/ai/goalkeeper-throw-preview'
import { MatchViewerSession } from '../../src/game/viewer/session'
import type { MatchState } from '../../src/game/match/state'

function physicallyCaughtBy(side: 0 | 1) {
  const setup = makeFictionalMatchSetup()
  const initial = createFoundationMatch(setup).getState()
  const keeperClub = setup.clubs[side].id
  const attackerClub = setup.clubs[1-side].id
  const direction = side === 0 ? 1 : -1
  const keeper = initial.players.find(p =>
    p.clubId === keeperClub && p.formationSlot === 'GK')!
  const attacker = initial.players.find(p =>
    p.clubId === attackerClub && p.formationSlot === 'ST')!
  const keeperX = side === 0 ? 4.7 : setup.pitch.lengthM - 4.7
  const old: MatchState = {
    ...initial, kickoff:null, clock:{...initial.clock,tick:23},
    players:initial.players.map(p =>
      p.playerId===keeper.playerId
        ? {...p,position:{xM:keeperX,yM:34},
          velocity:{xMps:0,yMps:0},engagesBall:true}
        : {...p,engagesBall:false}),
    ai:{...initial.ai,enabledTeams:[true,true],lastDecisionTick:22},
    ball:{...initial.ball,
      position:{xM:keeperX+direction*1.05,yM:34},
      velocity:{xMps:-direction*8,yMps:0,zMps:0},
      heightM:1,controllerId:null,controlOffset:null,
      lastTouchPlayerId:attacker.playerId,outsidePitch:false},
    contactEvents:[{commandId:'ai-shot-keeper-throw-l-test',
      playerId:attacker.playerId,kind:'kick',outcome:'kicked',tick:22,drawUsed:1}],
  }
  const after:MatchState={
    ...old,clock:{...old.clock,tick:24},
    ball:{...old.ball,position:{xM:keeperX+direction*.62,yM:34}},
  }
  const held=resolveAutomaticBallContact(old,after,setup)
  expect(held.automaticContactEvents.at(-1)?.outcome).toBe('caught')
  expect(held.ball.heightM).toBe(GOALKEEPER_HAND_HEIGHT_M)
  const later:MatchState={...held,clock:{...held.clock,tick:24+90}}
  return {setup,held,later,keeperId:keeper.playerId,keeperClub}
}

describe('Phase 6.9L — physical, ability-aware goalkeeper distribution', () => {
  it('rehearses the identical nominal initial throw velocity without mutating the held ball',()=>{
    const {setup,held}=physicallyCaughtBy(0)
    const keeper = held.players.find(p=>p.playerId===held.ball.controllerId)!
    const receiver=held.players.find(p=>
      p.clubId===keeper.clubId && p.formationSlot==='RCB')!
    const target={...receiver.position}
    const before=JSON.stringify(held)
    const speed=goalkeeperThrowVelocity(held.ball.position,target,.6)
    expect(Math.hypot(speed.xMps,speed.yMps)).toBeCloseTo(4.8+.6*9.3,7)
    expect(speed.zMps).toBeCloseTo(.4+.6*1.2,7)
    const outcome=previewPhysicalGoalkeeperThrow(held.ball,receiver,target,.6,
      setup,held.players.filter(p=>p.clubId!==keeper.clubId))
    expect(typeof outcome.canControl).toBe('boolean')
    expect(outcome.receptionSeconds===null ||
      (outcome.receptionSeconds>0&&outcome.receptionSeconds<=3.6)).toBe(true)
    expect(JSON.stringify(held)).toBe(before)
  })

  for (const side of [0,1] as const) {
    it(`identifies possible receiver choices for an actually held catch on side ${side}`,()=>{
      const {setup,held,later,keeperId,keeperClub}=physicallyCaughtBy(side)
      expect(chooseGoalkeeperThrow(held,setup)).toBeNull()
      const before=JSON.stringify(later)
      const options=assessGoalkeeperThrowOptions(later,setup)
      expect(options.length).toBeGreaterThan(0)
      expect(options.every(o=>o.teamId===keeperClub &&
        o.playerId===keeperId && o.receiverId!==keeperId)).toBe(true)
      expect(options.every(o=>Number.isFinite(o.utility) &&
        o.power>=0&&o.power<=1)).toBe(true)
      expect(options.every(o=>o.target.xM>=0&&o.target.xM<=setup.pitch.lengthM &&
        o.target.yM>=0&&o.target.yM<=setup.pitch.widthM)).toBe(true)
      expect(options.some(o=>o.forecast.canControl)).toBe(true)
      const chosen=chooseGoalkeeperThrow(later,setup)
      expect(chosen?.kind).toBe('throw')
      expect(chosen?.playerId).toBe(keeperId)
      expect(chosen?.teamId).toBe(keeperClub)
      expect(options.some(o=>o.receiverId===chosen?.receiverId &&
        o.power===chosen?.power)).toBe(true)
      expect(chooseGoalkeeperThrow(later,setup)).toEqual(chosen)
      expect(JSON.stringify(later)).toBe(before)
    })
  }

  for (const side of [0,1] as const) {
    it(`actually releases an aimed hand throw via the physical command resolver on side ${side}`,()=>{
      const {setup,later,keeperId}=physicallyCaughtBy(side)
      const selected=chooseGoalkeeperThrow(later,setup)
      expect(selected).not.toBeNull()
      const command={
        commandId:'ai-pass-throw-mirrored-l',
        type:'attemptGoalkeeperThrow' as const,
        teamId:selected!.teamId,playerId:keeperId,
        target:selected!.target,power:selected!.power,
        requestedTick:later.clock.tick-1,
        targetTick:later.clock.tick,
        appliedTick:later.clock.tick,sequence:1,
      }
      const authoritative:MatchState={...later,
        appliedCommands:[command]}
      const before=JSON.stringify(authoritative)
      const resolved=resolveContactAttempts(authoritative,setup)
      expect(resolved.contactEvents.at(-1)?.outcome).toBe('thrown')
      expect(resolved.contactEvents.at(-1)?.kind).toBe('throw')
      expect(resolved.ball.controllerId).toBeNull()
      expect(resolved.ball.lastTouchPlayerId).toBe(keeperId)
      expect(resolved.ball.velocity.zMps).toBeGreaterThan(0)
      expect(resolved.ball.velocity.xMps*(side===0?1:-1)).toBeGreaterThan(0)
      expect(Math.hypot(resolved.ball.velocity.xMps,
        resolved.ball.velocity.yMps))
        .toBeCloseTo(4.8+selected!.power*9.3,7)
      expect(JSON.stringify(authoritative)).toBe(before)
    })
  }

  it('scores threatened outlets lower than open, similarly reachable receivers',()=>{
    const {setup,later}=physicallyCaughtBy(0)
    const opts=assessGoalkeeperThrowOptions(later,setup)
    const viable=opts.filter(o=>o.forecast.canControl)
    expect(viable.length).toBeGreaterThanOrEqual(2)
    // Compare same launch candidate under an adversarial close marker.
    const high=viable[0]
    const opponent=later.players.find(p=>p.clubId!==high.teamId &&
      p.formationSlot==='ST')!
    const marker={...opponent,position:{
      xM:high.target.xM+1.2,yM:high.target.yM+.4},
      velocity:{xMps:0,yMps:0}}
    const marked:MatchState={...later,
      players:later.players.map(p=>p.playerId===opponent.playerId?marker:p)}
    const altered=assessGoalkeeperThrowOptions(marked,setup)
      .find(p=>p.receiverId===high.receiverId&&p.power===high.power)
    expect(altered).toBeDefined()
    expect(altered!.utility).toBeLessThan(high.utility)
    // This is a forecast penalty only: no interception or possession
    // was awarded to that opponent.
    expect(marked.ball.controllerId).toBe(later.ball.controllerId)
    expect(marked.automaticContactEvents).toEqual(later.automaticContactEvents)
  })

  it('uses real goalkeeper Decisions/Vision/Composure to value the SAME threatened lane differently',()=>{
    const {setup,later,keeperId}=physicallyCaughtBy(0)
    const high=assessGoalkeeperThrowOptions(later,setup)
    const candidate=high.find(o=>o.forecast.canControl)
    expect(candidate).toBeDefined()
    const opponent=later.players.find(p=>p.clubId!==candidate?.teamId &&
      p.formationSlot==='ST')!
    const threatened:MatchState={...later,
      players:later.players.map(p=>p.playerId===opponent.playerId
        ? {...p,position:{xM:candidate!.target.xM+2.3,yM:candidate!.target.yM+.5}} : p)}
    const withSkill = (skill:number)=>({
      ...setup,players:setup.players.map(p=>p.id!==keeperId ? p : {
        ...p,abilities:{...p.abilities,mental:{
          ...p.abilities.mental,vision:skill,decisions:skill,composure:skill,
        }},
      }),
    })
    const poor=assessGoalkeeperThrowOptions(threatened,withSkill(12))
      .find(o=>o.receiverId===candidate!.receiverId && o.power===candidate!.power)
    const aware=assessGoalkeeperThrowOptions(threatened,withSkill(95))
      .find(o=>o.receiverId===candidate!.receiverId && o.power===candidate!.power)
    expect(poor).toBeDefined()
    expect(aware).toBeDefined()
    expect(poor!.utility).not.toBe(aware!.utility)
    expect(threatened.ball.controllerId).toBe(keeperId)
  })

  it('preserves a real held goalkeeper throw and exact checkpoint replay',()=>{
    const session=new MatchViewerSession(42)
    for(let i=0;i<1200 && !session.state.ball.outsidePitch &&
        !session.state.automaticContactEvents.some(e=>e.outcome==='caught');i++) {
      session.advance(1)
    }
    expect(session.state.automaticContactEvents.some(e=>e.outcome==='caught'))
      .toBe(true)
    const cp=session.checkpoint()
    const restored=restoreFoundationMatch(cp)
    for(let i=0;i<130&&!session.state.ball.outsidePitch;i++) {
      session.advance(1)
      restored.advance(1)
      expect(restored.checkpoint()).toEqual(session.checkpoint())
      if(session.state.contactEvents.some(e=>e.outcome==='thrown'))break
    }
    const s=session.state
    const throws=s.contactEvents.filter(e=>e.outcome==='thrown')
    expect(throws.length).toBeGreaterThan(0)
    expect(throws.every(t=>s.appliedCommands.some(c=>
      c.commandId===t.commandId&&c.type==='attemptGoalkeeperThrow')))
      .toBe(true)
  },20000)
})
