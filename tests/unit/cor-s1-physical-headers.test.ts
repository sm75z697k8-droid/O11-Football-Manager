import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch,restoreFoundationMatch } from '../../src/game/match/engine'
import { recordOutOfPlay } from '../../src/game/match/restarts'
import { stageCorner,advanceCornerStoppage } from '../../src/game/match/corners'
import { applyDueMatchCommands } from '../../src/game/match/commands'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { advanceBallPhysics } from '../../src/game/physics/ball'
import { resolveAutomaticBallContact,sweptFootContact } from '../../src/game/physics/automatic-contact'
import { activePhysicalShot } from '../../src/game/ai/goal-directed'
import { activeOutfieldAerialDelivery,planOutfieldAerialDuels } from '../../src/game/ai/aerial-duels'
import { outfieldHeaderReach } from '../../src/game/physics/aerial-heading'
import type { MatchState } from '../../src/game/match/state'

/** The provenance is a real corner award and a real queued foot strike,
 * not a synthetic aerial ball or a pre-awarded header/goal. Player placement
 * inside the isolated collision fixture tests the 50ms swept geometry;
 * the LIVE corner integration separately verifies physical approach.
 */
function kickedCorner(side:'left'|'right'){
  const setup=makeFictionalMatchSetup()
  const original=createFoundationMatch(setup).getState()
  const defending=original.teams[side==='left'?0:1]
  const attacking=original.teams[side==='left'?1:0]
  const dir=side==='left'?1:-1
  const goalX=side==='left'?0:setup.pitch.lengthM
  const toucher=original.players.find(p=>p.clubId===defending.clubId &&
    p.formationSlot==='RCB')!
  const before:MatchState={...original,clock:{...original.clock,tick:100},
    ball:{...original.ball,position:{xM:goalX+dir*.09,yM:5},
      controllerId:null,controlOffset:null,
      velocity:{xMps:-dir*10,yMps:0,zMps:0},
      lastTouchPlayerId:toucher.playerId,outsidePitch:false}}
  const after:MatchState={...before,clock:{...before.clock,tick:101},
    ball:{...before.ball,position:{xM:goalX-dir*.18,yM:5},
      outsidePitch:true}}
  const dead=recordOutOfPlay(before,after,setup)
  const initial:MatchState={...dead,ai:{...dead.ai,
    enabledTeams:[true,true]}}
  const staged=stageCorner(initial,setup)
  const players=staged.players.map(p=>({...p,
    position:p.intention.kind==='moveToPoint'
      ? {...p.intention.target}:p.position,
    velocity:{xMps:0,yMps:0}}))
  const ready:MatchState={...initial,players,
    clock:{...initial.clock,tick:145}}
  const pending=stageCorner(ready,setup)
  const applied=applyDueMatchCommands({...pending,
    clock:{...pending.clock,tick:146}})
  const kicked=advanceCornerStoppage(applied,setup,resolveContactAttempts)
  expect(kicked.contactEvents.at(-1)?.outcome).toBe('cornerKicked')
  expect(kicked.ball.velocity.zMps).toBeGreaterThan(0)
  const attacker=kicked.players.find(p=>p.clubId===attacking.clubId &&
    p.formationSlot==='ST')!
  const defender=kicked.players.find(p=>p.clubId===defending.clubId &&
    p.formationSlot==='RCB')!
  return {setup,kicked,attacking,defending,attacker,defender}
}

function headFlight(side:'left'|'right'){
  const s=kickedCorner(side)
  let beforeBall=s.kicked.ball
  let hit:typeof beforeBall|null=null
  let tick=147
  for(;tick<202;tick++){
    const next=advanceBallPhysics(beforeBall,s.setup.pitch)
    const x=beforeBall.position.xM
    const nearEnd=x<21||x>s.setup.pitch.lengthM-21
    if(nearEnd && beforeBall.heightM>1.55 &&
        beforeBall.heightM<2.15 && beforeBall.velocity.zMps<0 &&
        Math.abs(beforeBall.position.yM-s.setup.pitch.widthM/2)<20){
      hit=beforeBall
      break
    }
    beforeBall=next
  }
  if(!hit)throw new Error('Real corner did not deliver a reachable falling ball')
  return {...s,hit,tick}
}

function duel(side:'left'|'right',winner:'attacker'|'defender'='attacker'){
  const s=headFlight(side)
  const preferred=winner==='attacker'?s.attacker:s.defender
  const other=winner==='attacker'?s.defender:s.attacker
  const point=s.hit.position
  const controller=preferred
  const prepared=s.kicked.players.map(p=>{
    if(p.playerId!==preferred.playerId && p.playerId!==other.playerId)
      return {...p,engagesBall:false}
    const at=p.playerId===preferred.playerId
      ? {xM:point.xM+.08,yM:point.yM+.06}
      : {xM:point.xM+1.32,yM:point.yM+.9}
    return {...p,position:at,velocity:{xMps:0,yMps:0},
      orientationRad:p.clubId===s.attacking.clubId
        ? s.attacking.attackingDirection===1?0:Math.PI
        : s.defending.attackingDirection===1?0:Math.PI,
      engagesBall:true,
      intention:{kind:'moveToPoint' as const,sinceTick:s.tick-8,
        target:{...point}}}
  })
  const changedSetup={...s.setup,players:s.setup.players.map(p=>
    p.id===controller.playerId
      ? {...p,abilities:{...p.abilities,
          technical:{...p.abilities.technical,heading:96}}}
      : p)}
  const snapshot=[preferred,other].map(p=>({
    playerId:p.playerId,clubId:p.clubId,action:'head' as const,
    engage:true,target:{...point},tick:s.tick-8}))
  const before:MatchState={...s.kicked,players:prepared,
    clock:{...s.kicked.clock,tick:s.tick-1},
    ball:s.hit,ai:{...s.kicked.ai,lastDecisionTick:s.tick-8,
      decisionSnapshot:snapshot}}
  const after:MatchState={...before,
    clock:{...before.clock,tick:s.tick},
    ball:advanceBallPhysics(before.ball,changedSetup.pitch)}
  return {...s,setup:changedSetup,before,after,
    chosen:controller,other}
}

describe('COR-S1 actual physical outfield headers and aerial duels',()=>{
  for(const side of ['left','right'] as const){
    it('recognizes actual corner-flight provenance and plans BOTH attacking and defending aerial runs '+side,()=>{
      const s=kickedCorner(side)
      expect(activeOutfieldAerialDelivery(s.kicked,s.setup)).not.toBeNull()
      const plans=planOutfieldAerialDuels(s.kicked,s.setup)
      expect(plans.size).toBeGreaterThanOrEqual(1)
      expect([...plans.values()].every(p=>p.arrivalSeconds>0 &&
        p.target.xM>0&&p.target.xM<s.setup.pitch.lengthM &&
        p.target.yM>0&&p.target.yM<s.setup.pitch.widthM)).toBe(true)
      expect(s.kicked.players.every(p=>p.position.xM>=0 &&
        p.position.xM<=s.setup.pitch.lengthM)).toBe(true)
      expect(s.kicked.automaticContactEvents).toHaveLength(0)
    })
    it('lets an attacking heading winner redirect ONLY a real swept contact and activate GK save logic '+side,()=>{
      const s=duel(side,'attacker')
      const original=JSON.stringify(s.after)
      const result=resolveAutomaticBallContact(s.before,s.after,s.setup)
      const ev=result.automaticContactEvents.at(-1)
      expect(ev?.kind).toBe('header')
      expect(ev?.outcome).toBe('headed')
      expect(ev?.playerId).toBe(s.attacker.playerId)
      expect(result.ball.controllerId).toBeNull()
      expect(result.ball.lastTouchPlayerId).toBe(s.attacker.playerId)
      expect(result.ball.velocity.xMps*s.attacking.attackingDirection)
        .toBeGreaterThan(3)
      expect(result.ball.position).toEqual(
        expect.objectContaining({xM:expect.any(Number),yM:expect.any(Number)}))
      expect(activePhysicalShot(result)?.shooterId).toBe(s.attacker.playerId)
      expect(result.goalEvents).toHaveLength(0)
      expect(JSON.stringify(s.after)).toBe(original)
    })
    it('allows a defender to win an aerial clearance in the same goalmouth '+side,()=>{
      const s=duel(side,'defender')
      const result=resolveAutomaticBallContact(s.before,s.after,s.setup)
      const ev=result.automaticContactEvents.at(-1)
      expect(ev?.kind).toBe('header')
      expect(ev?.outcome).toBe('headed')
      expect(ev?.playerId).toBe(s.defender.playerId)
      expect(result.ball.velocity.xMps*s.defending.attackingDirection)
        .toBeGreaterThan(3)
      expect(activePhysicalShot(result)).toBeNull()
      expect(result.ball.lastTouchPlayerId).toBe(s.defender.playerId)
      expect(result.ball.controllerId).toBeNull()
    })
  }

  it('height, jumping and elapsed recognition change actual head reach, not goals',()=>{
    const s=kickedCorner('right')
    const def=s.setup.players.find(p=>p.id===s.attacker.playerId)!
    const stronger={...def,profile:{...def.profile,heightCm:198},
      abilities:{...def.abilities,
        physical:{...def.abilities.physical,verticalLeap:98}}}
    const weaker={...def,profile:{...def.profile,heightCm:163},
      abilities:{...def.abilities,
        physical:{...def.abilities.physical,verticalLeap:8}}}
    const up=outfieldHeaderReach(s.attacker,stronger,.46)
    const low=outfieldHeaderReach(s.attacker,weaker,.46)
    const noReaction=outfieldHeaderReach(s.attacker,stronger,.02)
    expect(up.maximumHeightM).toBeGreaterThan(low.maximumHeightM+.5)
    expect(noReaction.maximumHeightM).toBeLessThan(up.maximumHeightM-.4)
    const h=(up.maximumHeightM+low.maximumHeightM)/2
    const ball={...s.kicked.ball,position:{xM:14,yM:30},
      heightM:h,velocity:{xMps:0,yMps:0,zMps:0}}
    const p={...s.attacker,position:{xM:14,yM:30}}
    expect(sweptFootContact(p,p,ball,ball,up.horizontalM,
      up.maximumHeightM,up.minimumHeightM)).not.toBeNull()
    expect(sweptFootContact(p,p,ball,ball,low.horizontalM,
      low.maximumHeightM,low.minimumHeightM)).toBeNull()
    expect(sweptFootContact(p,p,ball,ball)).toBeNull()
  })

  it('rejects headers without a genuine kick, jump engagement or reachable head-height ball',()=>{
    const s=duel('right')
    const withoutEngagement:MatchState={...s.after,
      ai:{...s.after.ai,decisionSnapshot:[]}}
    expect(resolveAutomaticBallContact(s.before,withoutEngagement,s.setup)
      .automaticContactEvents).toHaveLength(0)
    const tooHigh:MatchState={...s.after,
      ball:{...s.after.ball,heightM:4.2}}
    const prevHigh:MatchState={...s.before,
      ball:{...s.before.ball,heightM:4.25}}
    expect(resolveAutomaticBallContact(prevHigh,tooHigh,s.setup)
      .automaticContactEvents).toHaveLength(0)
    const diagnostic:MatchState={...s.after,contactEvents:[],
      appliedCommands:[],ball:{...s.after.ball,lastTouchPlayerId:null}}
    expect(activeOutfieldAerialDelivery(diagnostic,s.setup)).toBeNull()
    expect(resolveAutomaticBallContact(
      {...s.before,contactEvents:[],appliedCommands:[],
        ball:{...s.before.ball,lastTouchPlayerId:null}},
      diagnostic,s.setup).automaticContactEvents).toHaveLength(0)
  })

  it('reconstructs a genuine seeded live-match checkpoint identically after non-aerial football',()=>{
    const setup=makeFictionalMatchSetup()
    const one=createFoundationMatch(setup)
    one.advance(180)
    const restored=restoreFoundationMatch(one.checkpoint())
    for(let i=0;i<55;i++){
      one.advance(1)
      restored.advance(1)
      expect(restored.checkpoint()).toEqual(one.checkpoint())
    }
  })
})
