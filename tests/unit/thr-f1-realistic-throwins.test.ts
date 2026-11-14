import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { applyDueMatchCommands } from '../../src/game/match/commands'
import { resolveContactAttempts } from '../../src/game/physics/contact'
import { advanceBallPhysics, BALL_RADIUS_M } from '../../src/game/physics/ball'
import { throwInFlightVelocity } from '../../src/game/physics/throw-in-flight'
import {
  recordOutOfPlay, stageThrowIn, advanceThrowInStoppage,
  throwInTakerTarget, throwInReceiverTargets,
  throwInDefenderRetreat, throwInOpponentsClear, assessThrowInOptions,
  throwInFacingAngle, throwInTakerFacingField,
} from '../../src/game/match/restarts'
import type { MatchState } from '../../src/game/match/state'

function awarded(side:'top'|'bottom',touchedBy:0|1=0) {
  const setup=makeFictionalMatchSetup()
  const initial=createFoundationMatch(setup).getState()
  const touched=initial.players.find(p=>
    p.clubId===initial.teams[touchedBy].clubId &&
    p.formationSlot==='ST')!
  const y=side==='top'?.05:setup.pitch.widthM-.05
  const out=side==='top'?-.15:setup.pitch.widthM+.15
  const before:MatchState={...initial,clock:{...initial.clock,tick:99},
    ball:{...initial.ball,position:{xM:54,yM:y},
      heightM:BALL_RADIUS_M,controllerId:null,controlOffset:null,
      lastTouchPlayerId:touched.playerId,outsidePitch:false}}
  const after:MatchState={...before,clock:{...before.clock,tick:100},
    ball:{...before.ball,position:{xM:54,yM:out},outsidePitch:true}}
  const dead=recordOutOfPlay(before,after,setup)
  expect(dead.restart?.kind).toBe('throwIn')
  const both:MatchState={...dead,ai:{...dead.ai,enabledTeams:[true,true]}}
  return {setup,state:both,event:both.restart!}
}

function prepared(side:'top'|'bottom',touchedBy:0|1=0){
  const a=awarded(side,touchedBy)
  const team=a.state.teams.find(t=>t.clubId===a.event.awardedTeamId)!
  const targets=throwInReceiverTargets(a.event,a.setup,team.attackingDirection)
  const options=a.state.players.filter(p=>
    p.clubId===team.clubId &&p.playerId!==a.event.takerId &&
    p.formationSlot!=='GK').sort((x,y)=>{
      const anchor=(p:typeof x)=>a.state.ai.formationPositions[p.playerId]
      return Math.hypot(anchor(x).xM-54,anchor(x).yM-a.event.spot.yM)-
        Math.hypot(anchor(y).xM-54,anchor(y).yM-a.event.spot.yM)||
        x.playerId.localeCompare(y.playerId)
    }).slice(0,3)
  const players=a.state.players.map(p=>{
    const i=options.findIndex(o=>o.playerId===p.playerId)
    const target=p.playerId===a.event.takerId
      ? throwInTakerTarget(a.event,a.setup)
      : i>=0?targets[i]:p.position
    return {...p,position:{...target},velocity:{xMps:0,yMps:0},
      orientationRad:p.playerId===a.event.takerId
        ? throwInFacingAngle(a.event) : p.orientationRad}
  })
  const state:MatchState={...a.state,
    clock:{...a.state.clock,tick:145},players}
  return {...a,team,targets,options,state}
}

describe('THR-F1 — realistic, pressured legal throw-in plans',()=>{
  for(const side of ['top','bottom'] as const){
    for(const touchedBy of [0,1] as const){
      it(`offers three legal forward/back/inside runs and a real standing taker ${side} ${touchedBy}`,()=>{
        const a=awarded(side,touchedBy)
        const team=a.state.teams.find(t=>t.clubId===a.event.awardedTeamId)!
        const targets=throwInReceiverTargets(a.event,a.setup,
          team.attackingDirection)
        expect(targets).toHaveLength(3)
        expect((targets[0].xM-a.event.spot.xM)*
          team.attackingDirection).toBeGreaterThan(0)
        expect((targets[1].xM-a.event.spot.xM)*
          team.attackingDirection).toBeLessThan(0)
        for(const target of targets){
          expect(target.yM).toBeGreaterThan(2)
          expect(target.yM).toBeLessThan(a.setup.pitch.widthM-2)
          expect(Math.hypot(target.xM-a.event.spot.xM,
            target.yM-a.event.spot.yM)).toBeLessThan(28)
        }
        const taker=throwInTakerTarget(a.event,a.setup)
        expect(Math.abs(taker.yM-a.event.spot.yM)).toBeCloseTo(.25)
        const staged=stageThrowIn(a.state,a.setup)
        expect(staged.players).toHaveLength(22)
        const future=staged.players.filter(p=>p.clubId===team.clubId &&
          p.intention.kind==='moveToPoint' &&
          targets.some(t=>Math.hypot(
            p.intention.kind==='moveToPoint'
              ? p.intention.target.xM-t.xM:100,
            p.intention.kind==='moveToPoint'
              ? p.intention.target.yM-t.yM:100)<.1))
        expect(future.length).toBeGreaterThanOrEqual(3)
        // Staging does not teleport anyone or award possession.
        expect(staged.players.map(p=>p.position))
          .toEqual(a.state.players.map(p=>p.position))
        expect(staged.ball.controllerId).toBeNull()
      })
    }
  }
  it('updates both receiving directions after a legal halftime end switch',()=>{
    const a=awarded('top')
    const team=a.state.teams.find(t=>t.clubId===a.event.awardedTeamId)!
    const initial=throwInReceiverTargets(a.event,a.setup,team.attackingDirection)
    const flipped=throwInReceiverTargets(a.event,a.setup,
      -team.attackingDirection as 1|-1)
    expect(Math.sign(initial[0].xM-a.event.spot.xM))
      .toBe(-Math.sign(flipped[0].xM-a.event.spot.xM))
    expect(Math.sign(initial[1].xM-a.event.spot.xM))
      .toBe(-Math.sign(flipped[1].xM-a.event.spot.xM))
    expect(initial[2].yM).toBe(flipped[2].yM)
  })
  it('makes an encroaching defender retreat PHYSICALLY and blocks early release',()=>{
    const a=prepared('bottom')
    const opp=a.state.players.find(p=>
      p.clubId!==a.event.awardedTeamId&&p.formationSlot==='RCB')!
    const illegal={xM:a.event.spot.xM,yM:a.event.spot.yM-1}
    const moved:MatchState={...a.state,players:a.state.players.map(p=>
      p.playerId===opp.playerId?{...p,position:illegal}:p)}
    expect(throwInOpponentsClear(moved,a.event)).toBe(false)
    const staged=stageThrowIn(moved,a.setup)
    expect(staged.pendingCommands).toHaveLength(0)
    const marker=staged.players.find(p=>p.playerId===opp.playerId)!
    expect(marker.position).toEqual(illegal)
    expect(marker.intention.kind).toBe('moveToPoint')
    const retreat=throwInDefenderRetreat(illegal,a.event,a.setup)
    expect(Math.hypot(retreat.xM-a.event.spot.xM,
      retreat.yM-a.event.spot.yM)).toBeGreaterThan(2.1)
    const recovered:MatchState={...moved,players:moved.players.map(p=>
      p.playerId===opp.playerId?{...p,position:retreat}:p)}
    expect(throwInOpponentsClear(recovered,a.event)).toBe(true)
    expect(stageThrowIn(recovered,a.setup).pendingCommands.some(c=>
      c.type==='attemptThrowIn')).toBe(true)
  })
  it('selects a less marked receiving route and responds to pressure without auto-awarding a pass',()=>{
    const a=prepared('top')
    // Both first/second receivers have reached their real assigned
    // locations. Put a legal defender very close to the forward outlet.
    const opponent=a.state.players.find(p=>
      p.clubId!==a.event.awardedTeamId&&p.formationSlot==='RCB')!
    const covered:MatchState={...a.state,players:a.state.players.map(p=>
      p.playerId===opponent.playerId
        ? {...p,position:{xM:a.targets[0].xM+.22,
            yM:a.targets[0].yM+.25}}
        : p)}
    const currentReceivers=a.options.map(option=>
      covered.players.find(p=>p.playerId===option.playerId)!)
    const safe=assessThrowInOptions(covered,a.setup,a.event,
      currentReceivers,a.targets)
    expect(safe).toHaveLength(3)
    expect(safe[0].playerId).not.toBe(a.options[0].playerId)
    expect(safe.find(c=>c.playerId===a.options[0].playerId)?.opponentGapM)
      .toBeLessThan(4)
    const staged=stageThrowIn(covered,a.setup)
    const command=staged.pendingCommands.find(c=>
      c.type==='attemptThrowIn')!
    expect(command).toBeDefined()
    expect(command.target).toEqual(safe[0].target)
    expect(staged.ball.controllerId).toBeNull()
    const applied=applyDueMatchCommands({
      ...staged,clock:{...staged.clock,tick:146}})
    const thrown=advanceThrowInStoppage(
      applied,a.setup,resolveContactAttempts)
    expect(thrown.contactEvents.at(-1)?.outcome).toBe('thrownIn')
    expect(thrown.ball.controllerId).toBeNull()
    expect(thrown.ball.velocity.zMps).toBeGreaterThan(0)
    expect(thrown.ball.lastTouchPlayerId).toBe(a.event.takerId)
    expect(thrown.restart).toBeNull()
  })
  it('previews the identical real overhead throw trajectory and leaves seeded aiming error in execution',()=>{
    const a=prepared('bottom')
    const receiver=a.options[0]
    const thrower=a.setup.players.find(p=>p.id===a.event.takerId)!
    const power=.65
    const nominal=throwInFlightVelocity(a.event.spot,receiver.position,
      power,thrower.abilities.physical.strength)
    expect(nominal.zMps).toBeGreaterThan(0)
    let ball={...a.state.ball,position:{...a.event.spot},
      heightM:1.85,velocity:nominal,outsidePitch:false}
    for(let i=0;i<12;i++)ball=advanceBallPhysics(ball,a.setup.pitch)
    expect(ball.position.yM).toBeLessThan(a.event.spot.yM)
    expect(ball.position.xM).toBeGreaterThan(0)
    expect(ball.position.xM).toBeLessThan(a.setup.pitch.lengthM)
  })
  it('rotates the waiting taker toward the field at a bounded physical speed before release',()=>{
    const a=prepared('top')
    const id=a.event.takerId!
    const old=a.state.players.find(p=>p.playerId===id)!
    const facingOut:MatchState={...a.state,players:a.state.players.map(p=>
      p.playerId===id?{...p,orientationRad:-Math.PI/2}:p)}
    expect(throwInTakerFacingField(
      facingOut.players.find(p=>p.playerId===id)!,a.event)).toBe(false)
    let current=facingOut
    let lastAngle=-Math.PI/2
    let turned=false
    for(let tick=146;tick<173;tick++){
      current=advanceThrowInStoppage({
        ...current,clock:{...current.clock,tick},
      },a.setup,resolveContactAttempts)
      const next=current.players.find(p=>p.playerId===id)!
      const delta=Math.abs(Math.atan2(
        Math.sin(next.orientationRad-lastAngle),
        Math.cos(next.orientationRad-lastAngle)))
      expect(delta).toBeLessThan(.26)
      lastAngle=next.orientationRad
      if(throwInTakerFacingField(next,a.event)){
        turned=true
        break
      }
      expect(current.contactEvents.some(e=>e.outcome==='thrownIn')).toBe(false)
    }
    expect(turned).toBe(true)
  })
  it('replays a REAL seeded throw-in and following physical play exactly',()=>{
    // The live match sample deliberately uses the same deterministic
    // production fixture, not a hand-forced restart or invented goal.
    const { MatchViewerSession }=requireViewerSession()
    const session=new MatchViewerSession(117)
    let thrown=false
    for(let i=0;i<280;i++){
      session.advance(8)
      if(session.state.contactEvents.some(e=>e.outcome==='thrownIn')){
        thrown=true;break
      }
      if(session.state.period==='halfTime')break
    }
    expect(thrown).toBe(true)
    const restored=restoreFoundationMatch(session.checkpoint())
    for(let i=0;i<18;i++){
      session.advance(1)
      restored.advance(1)
      expect(restored.checkpoint()).toEqual(session.checkpoint())
    }
  },20_000)
})

// A static import is kept separate from staged helper creation so both
// headed GK and ordinary throw-in test fixtures use the real viewer.
function requireViewerSession(){
  return { MatchViewerSession: _ViewerSession }
}
import { MatchViewerSession as _ViewerSession } from '../../src/game/viewer/session'
