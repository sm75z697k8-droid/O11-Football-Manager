import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, FoulEvent } from './state'
import { BALL_RADIUS_M } from '../physics/ball'
import { FOOT_REACH_M } from '../physics/contact'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { scheduleMatchCommand } from './commands'
import { offsideSnapshot } from './offside'

/** S1.7: geometrical body contact and attribute-aware judgement.
 * All values are uncalibrated simulator estimates, not real-world foul rates.
 * A body collision is not a foul on its own. Ball-first wins stay clean.
 */
export const FOUL_RULES_VERSION='player-body-contest-and-physical-free-kicks-s17-v1'
export const PLAYER_BODY_CONTACT_M=.86
export const FOUL_CLEARANCE_M=9.15
const DT=.05
const clamp=(n:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,n))
const distance=(a:Point2,b:Point2)=>Math.hypot(a.xM-b.xM,a.yM-b.yM)
const interpolate=(a:Point2,b:Point2,t:number):Point2=>({
  xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t,
})

/** First physical *entry* into the tackle body's radius over a real 50ms
 * motion segment. A standing overlap does not create repeated offences.
 */
export function sweptBodyEntry(
  oldDef:Point2,newDef:Point2,oldCarrier:Point2,newCarrier:Point2,
  radius=PLAYER_BODY_CONTACT_M,
):number|null{
  const rx=oldDef.xM-oldCarrier.xM,ry=oldDef.yM-oldCarrier.yM
  const vx=(newDef.xM-oldDef.xM)-(newCarrier.xM-oldCarrier.xM)
  const vy=(newDef.yM-oldDef.yM)-(newCarrier.yM-oldCarrier.yM)
  const c=rx*rx+ry*ry-radius*radius
  if(c<=0)return null
  const a=vx*vx+vy*vy
  if(a<=1e-12)return null
  const b=2*(rx*vx+ry*vy)
  if(b>=0)return null
  const disc=b*b-4*a*c
  if(disc<0)return null
  const t=(-b-Math.sqrt(disc))/(2*a)
  return t>=0&&t<=1?t:null
}

export interface BodyChallenge {
  readonly defenderId:string
  readonly carrierId:string
  readonly entryFraction:number
  readonly impactSpeedMps:number
  readonly angle:'front'|'side'|'behind'
  readonly riskScore:number
  readonly foul:boolean
}
/** A deliberate tackler must be committed to pressing the current carrier.
 * This prevents off-ball crowding, marking and incidental collisions from
 * becoming phantom fouls. Goalkeeper smothers have independent physics.
 */
export function assessBodyChallenge(
  before:MatchState,after:MatchState,setup:MatchSetup,
):BodyChallenge|null {
  const controller=before.ball.controllerId
  if(!controller || before.ball.outsidePitch ||
    before.ball.heightM>.5 || after.offsideRestart ||
    after.postGoalKickoff || after.periodKickoff || after.restart ||
    after.foulRestart || before.kickoff?.phase==='awaitingKick') return null
  const oldCarrier=before.players.find(p=>p.playerId===controller)
  const carrier=after.players.find(p=>p.playerId===controller)
  if(!oldCarrier || !carrier)return null
  const carrierDef=setup.players.find(p=>p.id===carrier.playerId)
  if(!carrierDef)return null
  // A clean ball-winning challenge at this tick is not a foul merely
  // because the defender's body intersects the ball carrier.
  const auto=after.automaticContactEvents.at(-1)
  const defenders=after.players.filter(p=>p.clubId!==carrier.clubId &&
    p.participation==='onField' && p.engagesBall &&
    p.formationSlot!=='GK')
  const options:BodyChallenge[]=[]
  for(const defender of defenders){
    const planned=after.ai.decisionSnapshot.find(d=>d.playerId===defender.playerId)
    if(planned && planned.action!=='press')continue
    const oldDef=before.players.find(p=>p.playerId===defender.playerId)
    const profile=setup.players.find(p=>p.id===defender.playerId)
    if(!oldDef||!profile)continue
    const entry=sweptBodyEntry(
      oldDef.position,defender.position,oldCarrier.position,carrier.position)
    if(entry===null)continue
    if(auto?.tick===after.clock.tick && auto.playerId===defender.playerId &&
      (auto.outcome==='wonChallenge' || auto.outcome==='caught'))continue
    const contact=interpolate(oldCarrier.position,carrier.position,entry)
    const dp=interpolate(oldDef.position,defender.position,entry)
    const relative=Math.hypot(
      defender.velocity.xMps-carrier.velocity.xMps,
      defender.velocity.yMps-carrier.velocity.yMps)
    const faceX=Math.cos(carrier.orientationRad)
    const faceY=Math.sin(carrier.orientationRad)
    const forward=((dp.xM-contact.xM)*faceX+
      (dp.yM-contact.yM)*faceY)/Math.max(.01,distance(dp,contact))
    const angle=forward<-.45?'behind' as const:
      forward<.45?'side' as const:'front' as const
    const skill=profile.abilities
    const risk=
      relative*1.18+
      (angle==='behind'?9:angle==='side'?4:0)+
      (100-skill.technical.tackling)*.14+
      skill.mental.aggression*.075+
      (100-skill.mental.decisions)*.105+
      (100-skill.mental.composure)*.06+
      (100-skill.mental.anticipation)*.035-
      carrierDef.abilities.physical.balance*.018
    // A collision with no meaningful relative force is not automatically
    // illegal. Skill and body approach decide whether contact is careless.
    options.push({
      defenderId:defender.playerId,carrierId:carrier.playerId,
      entryFraction:entry,impactSpeedMps:relative,angle,riskScore:risk,
      foul:relative>=1.15 && risk>=25.5,
    })
  }
  options.sort((a,b)=>a.entryFraction-b.entryFraction ||
    a.defenderId.localeCompare(b.defenderId))
  return options.find(p=>p.foul)??options[0]??null
}

export function insideDefendingPenaltyArea(
  p:Point2,defendingTeamId:string,state:MatchState,
  setup:MatchSetup,
):boolean{
  const team=state.teams.find(t=>t.clubId===defendingTeamId)
  if(!team)return false
  const fromDefendingGoal=team.attackingDirection===1
    ? p.xM:setup.pitch.lengthM-p.xM
  return fromDefendingGoal<=setup.pitch.penaltyAreaDepthM &&
    Math.abs(p.yM-setup.pitch.widthM/2)<=setup.pitch.penaltyAreaWidthM/2
}

function chooseTaker(
  state:MatchState,setup:MatchSetup,teamId:string,spot:Point2,
  penalty:boolean,
):PlayerMatchState{
  const choices=state.players.filter(p=>p.clubId===teamId &&
    p.formationSlot!=='GK').sort((a,b)=>{
    const ap=setup.players.find(d=>d.id===a.playerId)!
    const bp=setup.players.find(d=>d.id===b.playerId)!
    const score=(p:PlayerMatchState,skill:typeof ap)=>
      penalty
        ? .75*skill.abilities.technical.penaltyTaking+
          .25*skill.abilities.mental.composure
        : 60-distance(p.position,spot)*1.2+
          skill.abilities.technical.freeKicks*.18
    return score(b,bp)-score(a,ap)||a.playerId.localeCompare(b.playerId)
  })
  if(!choices[0])throw new Error('No outfield free-kick taker')
  return choices[0]
}

/** Award a real Law 12 direct free kick or penalty from a physical,
 * careless body challenge, before goal-line and touchline adjudication.
 */
export function adjudicatePhysicalFoul(
  before:MatchState,after:MatchState,setup:MatchSetup,
):MatchState{
  if(before.foulRestart || after.offsideRestart || before.restart ||
    before.periodKickoff || before.postGoalKickoff)return after
  const judged=assessBodyChallenge(before,after,setup)
  if(!judged?.foul)return after
  const offender=after.players.find(p=>p.playerId===judged.defenderId)!
  const victimBefore=before.players.find(p=>p.playerId===judged.carrierId)!
  const victim=after.players.find(p=>p.playerId===judged.carrierId)!
  const spot=interpolate(victimBefore.position,victim.position,
    judged.entryFraction)
  const penalty=insideDefendingPenaltyArea(spot,offender.clubId,after,setup)
  const taking=after.teams.find(t=>t.clubId===victim.clubId)!
  const ballSpot=penalty?{
    xM:taking.attackingDirection===1
      ? setup.pitch.lengthM-setup.pitch.penaltySpotDistanceM
      : setup.pitch.penaltySpotDistanceM,
    yM:setup.pitch.widthM/2,
  }:{xM:clamp(spot.xM,BALL_RADIUS_M,
      setup.pitch.lengthM-BALL_RADIUS_M),
    yM:clamp(spot.yM,BALL_RADIUS_M,
      setup.pitch.widthM-BALL_RADIUS_M)}
  const taker=chooseTaker(after,setup,victim.clubId,ballSpot,penalty)
  const foul:FoulEvent={
    tick:after.clock.tick,offenderId:offender.playerId,
    victimId:victim.playerId,awardedTeamId:victim.clubId,
    kind:penalty?'penalty':'directFreeKick',spot,ballSpot,
    takerId:taker.playerId,entryFraction:judged.entryFraction,
    impactSpeedMps:judged.impactSpeedMps,riskScore:judged.riskScore,
  }
  return {...after,foulRestart:foul,
    foulEvents:[...after.foulEvents,foul],offsidePhase:null,
    indirectFreeKick:null,
    ball:{...after.ball,position:ballSpot,heightM:BALL_RADIUS_M,
      velocity:{xMps:0,yMps:0,zMps:0},
      controllerId:null,controlOffset:null,outsidePitch:false},
    ai:{...after.ai,passIntent:null,decisionSnapshot:[]},
  }
}
export function foulKickPrefix(event:FoulEvent):string{
  return event.kind==='penalty'
    ? 'ai-shot-penalty-'+event.tick+'-'
    : 'ai-pass-foul-'+event.tick+'-'
}
export function foulKickStationary(state:MatchState):boolean{
  const b=state.ball
  return !b.outsidePitch && b.heightM===BALL_RADIUS_M &&
    b.controllerId===null && b.velocity.xMps===0 &&
    b.velocity.yMps===0 && b.velocity.zMps===0
}
function legalPenaltyAreaPosition(
  p:PlayerMatchState,event:FoulEvent,state:MatchState,
  setup:MatchSetup,
):boolean{
  const attacking=state.teams.find(t=>t.clubId===event.awardedTeamId)!
  const sign=attacking.attackingDirection
  const behind=(p.position.xM-event.ballSpot.xM)*sign<-.05
  const outside=!(insideDefendingPenaltyArea(
    p.position,state.teams.find(t=>t.clubId!==attacking.clubId)!.clubId,
    state,setup))
  return behind && outside &&
    distance(p.position,event.ballSpot)>=FOUL_CLEARANCE_M-.02
}
export function foulRestartPlayersLegal(state:MatchState,setup:MatchSetup):boolean{
  const ev=state.foulRestart
  if(!ev)return false
  const taker=state.players.find(p=>p.playerId===ev.takerId)
  if(!taker || distance(taker.position,ev.ballSpot)>FOOT_REACH_M-.025 ||
    !foulKickStationary(state))return false
  if(ev.kind==='directFreeKick')
    return state.players.every(p=>p.clubId===ev.awardedTeamId ||
      distance(p.position,ev.ballSpot)>=FOUL_CLEARANCE_M-.02)
  const defendingTeam=state.teams.find(t=>t.clubId!==ev.awardedTeamId)!
  const keeper=state.players.find(p=>p.clubId===defendingTeam.clubId &&
    p.formationSlot==='GK')
  const keeperX=defendingTeam.attackingDirection===1?0:setup.pitch.lengthM
  if(!keeper || Math.abs(keeper.position.xM-keeperX)>.2 ||
    Math.abs(keeper.position.yM-setup.pitch.widthM/2)>setup.pitch.goalWidthM/2)
    return false
  return state.players.every(p=>p.playerId===ev.takerId ||
    p.playerId===keeper.playerId ||
    legalPenaltyAreaPosition(p,ev,state,setup))
}
function retreatFromSpot(p:Point2,spot:Point2,pitch:MatchSetup['pitch']):Point2{
  const d=distance(p,spot)
  if(d>=FOUL_CLEARANCE_M+.35)return p
  const dx=p.xM-spot.xM,dy=p.yM-spot.yM
  const towardsCentreX=spot.xM<=pitch.lengthM/2?1:-1
  const towardsCentreY=spot.yM<=pitch.widthM/2?1:-1
  const x=clamp(spot.xM+(d>.01?dx/d:towardsCentreX)*
    (FOUL_CLEARANCE_M+1.4),.25,pitch.lengthM-.25)
  const y=clamp(spot.yM+(d>.01?dy/d:towardsCentreY)*
    (FOUL_CLEARANCE_M+1.4),.25,pitch.widthM-.25)
  if(distance({xM:x,yM:y},spot)>=FOUL_CLEARANCE_M+.01)
    return {xM:x,yM:y}
  const centreX=clamp(spot.xM+towardsCentreX*
    (FOUL_CLEARANCE_M+1.5),.25,pitch.lengthM-.25)
  return {xM:centreX,yM:spot.yM}
}
function foulTarget(
  p:PlayerMatchState,event:FoulEvent,state:MatchState,
  setup:MatchSetup,
):Point2{
  const direction=state.teams.find(t=>t.clubId===event.awardedTeamId)!
    .attackingDirection
  const spot=event.ballSpot
  if(p.playerId===event.takerId)return {
    xM:clamp(spot.xM-direction*.52,.25,setup.pitch.lengthM-.25),
    yM:spot.yM,
  }
  if(event.kind==='directFreeKick'){
    return p.clubId===event.awardedTeamId
      ? p.position:retreatFromSpot(p.position,spot,setup.pitch)
  }
  const defender=state.teams.find(t=>t.clubId!==event.awardedTeamId)!
  if(p.clubId===defender.clubId && p.formationSlot==='GK')
    return {xM:defender.attackingDirection===1?.05:
      setup.pitch.lengthM-.05,yM:setup.pitch.widthM/2}
  if(legalPenaltyAreaPosition(p,event,state,setup))return p.position
  // Every outfielder must remain behind the penalty mark and outside the
  // defending penalty area. Their real y-location is retained where legal.
  const x=direction===1
    ? setup.pitch.lengthM-setup.pitch.penaltyAreaDepthM-2
    : setup.pitch.penaltyAreaDepthM+2
  const candidate={xM:x,yM:clamp(p.position.yM,.25,setup.pitch.widthM-.25)}
  return retreatFromSpot(candidate,spot,setup.pitch)
}

/** All repositioning uses genuine player locomotion at 20Hz. */
export function stageFoulRestart(state:MatchState,setup:MatchSetup):MatchState{
  const ev=state.foulRestart
  if(!ev)return state
  const index=state.teams.findIndex(t=>t.clubId===ev.awardedTeamId)
  if(index<0 || !state.ai.enabledTeams[index])return state
  const players=state.players.map(p=>{
    const teamIndex=state.teams.findIndex(t=>t.clubId===p.clubId)
    if(teamIndex<0||!state.ai.enabledTeams[teamIndex])return p
    const target=foulTarget(p,ev,state,setup)
    if(distance(target,p.position)<.08 &&
      p.velocity.xMps===0 && p.velocity.yMps===0)return p
    return {...p,engagesBall:false,
      intention:{kind:'moveToPoint' as const,
        sinceTick:state.clock.tick,target}}
  })
  let staged:MatchState={...state,players,
    ai:{...state.ai,passIntent:null,decisionSnapshot:[]}}
  const pending=state.pendingCommands.some(c=>
    c.commandId.startsWith(foulKickPrefix(ev)))
  if(!pending && state.clock.tick-ev.tick>=14 &&
      foulRestartPlayersLegal(staged,setup)){
    const attacking=state.teams[index]
    let target:Point2
    let power:number
    let lift:number
    if(ev.kind==='penalty'){
      target={
        xM:attacking.attackingDirection===1
          ? setup.pitch.lengthM-.02:.02,
        yM:setup.pitch.widthM/2+
          (state.seed%3-1)*1.35,
      }
      power=.57;lift=.075
    }else{
      const friends=players.filter(p=>p.clubId===ev.awardedTeamId &&
        p.playerId!==ev.takerId)
        .sort((a,b)=>distance(a.position,ev.ballSpot)-
          distance(b.position,ev.ballSpot) ||
          a.playerId.localeCompare(b.playerId))
      target=friends[0]
        ? friends[0].position
        : {xM:clamp(ev.ballSpot.xM+
          attacking.attackingDirection*12,1,setup.pitch.lengthM-1),
          yM:ev.ballSpot.yM}
      if(distance(target,ev.ballSpot)<2)
        target={xM:clamp(ev.ballSpot.xM+
          attacking.attackingDirection*12,1,setup.pitch.lengthM-1),
          yM:clamp(ev.ballSpot.yM+4,1,setup.pitch.widthM-1)}
      power=.38;lift=0
    }
    const receipt=scheduleMatchCommand(staged,{
      commandId:foulKickPrefix(ev)+ev.takerId,
      teamId:ev.awardedTeamId,type:'attemptKick',
      playerId:ev.takerId,target,power,lift,
    },setup.pitch)
    if(receipt.receipt.accepted)
      staged={...receipt.state,ai:{...staged.ai,
        lastPassTick:state.clock.tick}}
  }
  return staged
}
export function advanceFoulRestart(
  state:MatchState,setup:MatchSetup,
  resolve:(state:MatchState,setup:MatchSetup)=>MatchState,
):MatchState{
  const staged=stageFoulRestart(state,setup)
  const moved=advancePlayerLocomotion(staged,setup.players,setup.pitch)
  const contacted=resolve(moved,setup)
  const ev=contacted.foulRestart
  if(!ev)return contacted
  const released=contacted.contactEvents.at(-1)
  if(!released || released.tick!==contacted.clock.tick ||
    released.outcome!=='kicked' || released.playerId!==ev.takerId ||
    !released.commandId.startsWith(foulKickPrefix(ev)))return contacted
  return {...contacted,foulRestart:null,
    offsidePhase:offsideSnapshot(contacted,setup,ev.takerId)}
}
