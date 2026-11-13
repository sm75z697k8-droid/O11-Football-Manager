import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { PlayerDefinition } from '../model/player'
import type { MatchState, PlayerMatchState } from '../match/state'
import { boundedTarget, separationM } from './coordination'
import { laneObstruction } from './possession'

/**
 * ATT-S1: One shared 4-3-3 attacking picture, not independent scripted goals.
 * Reserves complementary REAL movement targets before the ordinary support
 * search fills remaining positions. No possession or goal is created here.
 *
 * These metre thresholds are initial simulator estimates, not calibrated
 * professional movement rates. Recompute only on an AI decision cycle.
 */
export const ATTACK_COORDINATION_VERSION = 'complementary-physical-attacking-runs-att-s1-v1'
export type CoordinatedRunRole =
  | 'insideForward' | 'midfieldArrival' | 'strikerLink'
  | 'wideOutlet' | 'fullbackSupport'
export interface CoordinatedAttackRun {
  readonly playerId: string
  readonly target: Point2
  readonly role: CoordinatedRunRole
  /** A bounded positioning preference, never a scoring probability. */
  readonly utilityBonus: number
  readonly clearanceM: number
}

const MAX_RUN_M = 18
const MIN_RUN_M = 2.3
const MIN_CARRIER_DISTANCE_M = 5.7
const MAX_CARRIER_DISTANCE_M = 33
const MIN_RUNNER_SPACING_M = 6.3
const clamp = (v:number, low:number, high:number) =>
  Math.max(low, Math.min(high,v))
const nearby = (p:Point2, players:readonly PlayerMatchState[]) =>
  players.reduce((d,other)=>Math.min(d,separationM(p,other.position)),100)
const isWinger = (p:PlayerMatchState) =>
  p.formationSlot==='RW' || p.formationSlot==='LW'
const isCentralMidfielder = (p:PlayerMatchState) =>
  p.formationSlot==='RCM' || p.formationSlot==='LCM'
const isFullback = (p:PlayerMatchState) =>
  p.formationSlot==='RB' || p.formationSlot==='LB'
const sideOf = (p:PlayerMatchState,direction:1|-1) =>
  (p.formationSlot==='RW' || p.formationSlot==='RCM' ||
    p.formationSlot==='RB' ? 1:-1)*direction

function roleSkill(def:PlayerDefinition,role:CoordinatedRunRole):number{
  const a=def.abilities
  const gameReading=.37*a.mental.offTheBall+
    .28*a.mental.anticipation+.20*a.mental.decisions+
    .15*a.mental.teamwork
  if(role==='midfieldArrival')
    return .72*gameReading+.18*a.technical.longShots+
      .10*a.technical.firstTouch
  if(role==='insideForward')
    return .60*gameReading+.22*a.physical.acceleration+
      .18*a.technical.finishing
  if(role==='strikerLink')
    return .55*gameReading+.27*a.technical.firstTouch+
      .18*a.mental.vision
  if(role==='fullbackSupport')
    return .58*gameReading+.25*a.physical.stamina+
      .17*a.technical.crossing
  return .73*gameReading+.27*a.technical.firstTouch
}

function candidatesFor(
  role:CoordinatedRunRole,player:PlayerMatchState,
  carrier:PlayerMatchState,reference:Point2,direction:1|-1,
  setup:MatchSetup,
):readonly Point2[]{
  const c=setup.pitch.widthM/2
  const side=sideOf(player,direction)
  const x=(offset:number)=>reference.xM+direction*offset
  const point=(advance:number, y:number)=>boundedTarget({
    xM:x(advance), yM:clamp(y,2.5,setup.pitch.widthM-2.5),
  },setup.pitch)
  switch(role){
    case 'insideForward':
      // Behind the striker or between centre-back/full-back. Both flanks
      // qualify; no rule selects the striker as the mandatory final receiver.
      return [point(12,c+side*11),point(9,c+side*14),
        point(14,c+side*17),point(7,c+side*10)]
    case 'midfieldArrival':
      // Arrive as a second line, separate from the advanced runner.
      return [point(6,c+side*8),point(9,c+side*11),
        point(3,c+side*13),point(5,c+side*5)]
    case 'strikerLink':
      // Attract a central defender by offering to feet, but not every time.
      return [point(3,c),point(7,c+4),point(7,c-4),
        point(-2,c)]
    case 'wideOutlet':
      // Hold one flank so a centre run does not eliminate all width.
      return [point(4,c+side*23),point(9,c+side*22),
        point(1,c+side*25)]
    case 'fullbackSupport':{
      // An overlapping full-back requires an attack/support duty and
      // another teammate screening the turnover. Defend duty stays behind
      // the ball, providing a safe outlet instead of running into the box.
      const forward=player.duty==='attack'||player.duty==='support'
      const cForward=isWinger(carrier)?7:3
      return forward
        ? [point(cForward,c+side*25),point(1,c+side*23)]
        : [point(-9,c+side*24),point(-13,c+side*22)]
    }
  }
}

interface ScoredRun extends CoordinatedAttackRun {
  readonly utility:number
}
function chooseRole(
  role:CoordinatedRunRole, state:MatchState,setup:MatchSetup,
  carrier:PlayerMatchState,teammates:readonly PlayerMatchState[],
  opponents:readonly PlayerMatchState[], reserved:readonly Point2[],
  excluded:ReadonlySet<string>,offsideCeiling:number,
):ScoredRun|null {
  const direction=state.teams.find(t=>t.clubId===carrier.clubId)!
    .attackingDirection
  const reference=carrier.position
  const definitionById=new Map(setup.players.map(p=>[p.id,p]))
  const centre=setup.pitch.widthM/2
  const goalDistance=direction===1
    ? setup.pitch.lengthM-reference.xM:reference.xM
  let best:ScoredRun|null=null
  for(const runner of teammates){
    if(excluded.has(runner.playerId) ||
      runner.playerId===carrier.playerId ||
      runner.formationSlot==='GK' ||
      runner.formationSlot==='DM' ||
      runner.formationSlot==='RCB' ||
      runner.formationSlot==='LCB')continue
    const matches=role==='insideForward'||role==='wideOutlet'
      ? isWinger(runner):role==='midfieldArrival'
        ? isCentralMidfielder(runner):role==='strikerLink'
          ? runner.formationSlot==='ST':isFullback(runner)
    if(!matches)continue
    // Keep the same-side fullback behind the ball on a winger's inward run;
    // never select the opposite fullback as a second automatic overlapping
    // wingback. Other defenders/DM retain rest-defence shape.
    if(role==='fullbackSupport' && isWinger(carrier) &&
      sideOf(carrier,direction)!==sideOf(runner,direction))continue
    if(role==='fullbackSupport' &&
      (runner.energy<38 || (
        // Require real rest defence before a support/attack-duty fullback
        // overlaps. A defensive-duty fullback only supplies a safe outlet.
        runner.duty!=='defend' && !teammates.some(p=>
          p.formationSlot==='DM' &&
          (carrier.position.xM-p.position.xM)*direction>=7) )))
      continue
    const def=definitionById.get(runner.playerId)
    const anchor=state.ai.formationPositions[runner.playerId]
    if(!def||!anchor)continue
    const ceilingMargin=offsideCeiling-.15
    for(const point of candidatesFor(role,runner,carrier,reference,direction,setup)){
      const forward=point.xM*direction
      if(forward>ceilingMargin)continue
      // Do not turn a deep defensive shape into an implausible teleport
      // of an already far-away wing-back into the opposition penalty box.
      const travel=separationM(runner.position,point)
      const fromAnchor=separationM(anchor,point)
      const maxAnchor=role==='fullbackSupport'
        ? runner.duty==='defend'?28:56 : 38
      if(travel<MIN_RUN_M||travel>MAX_RUN_M ||
        fromAnchor>maxAnchor)continue
      const fromCarrier=separationM(reference,point)
      if(fromCarrier<MIN_CARRIER_DISTANCE_M ||
        fromCarrier>MAX_CARRIER_DISTANCE_M)continue
      const spacing=reserved.reduce((distance,p)=>
        Math.min(distance,separationM(point,p)),100)
      if(spacing<MIN_RUNNER_SPACING_M)continue
      const space=nearby(point,opponents)
      if(space<4.4)continue
      const lane=laneObstruction(reference,point,opponents)
      if(lane>3.1)continue
      // Preserve flank identities: wide role must stay wide, the attacking
      // CM must use its own half-space; only a forward may cut inside.
      const side=sideOf(runner,direction)
      if((point.yM-centre)*side<
        (role==='midfieldArrival'?3:role==='strikerLink'?0:
          role==='insideForward'?8:17))continue
      const forwardGain=(point.xM-reference.xM)*direction
      const skill=roleSkill(def,role)
      const otherCrowding=teammates.reduce((p,teammate)=>{
        if(teammate.playerId===runner.playerId ||
          teammate.playerId===carrier.playerId)return p
        return p+Math.max(0,4.5-
          separationM(teammate.position,point))*.45
      },0)
      const wideCarrier=isWinger(carrier)
      const tactical=role==='midfieldArrival'&&wideCarrier?4:
        role==='insideForward' && carrier.formationSlot==='ST'?3:
          role==='strikerLink' && wideCarrier?2:0
      const forwards=role==='insideForward'||role==='midfieldArrival'
      const progress=forwards?Math.max(0,forwardGain)*.28:
        role==='strikerLink'?Math.max(0,forwardGain)*.13:0
      const stability=runner.intention.kind==='moveToPoint' &&
        separationM(point,runner.intention.target)<3?2.2:0
      // These are ranked spatial opportunities, not success-rate rolls.
      const score=skill*.095+Math.min(space,12)*1.55-
        lane*3.1-travel*.38-fromAnchor*.12-otherCrowding+
        progress+tactical+stability-
        Math.max(0,goalDistance-42)*.12
      const bonus=clamp(score*.22,2.5,11)
      if(!best||score>best.utility+1e-8||
        (Math.abs(score-best.utility)<1e-8 &&
        runner.playerId<best.playerId)){
        best={playerId:runner.playerId,target:point,role,
          utility:score,utilityBonus:bonus,clearanceM:space}
      }
    }
  }
  return best
}

/** Team-level reservation (2-4 complementary targets). Existing one-two /
 * third-man physical runs can exclude their committed runner. All fallback
 * support positions are still chosen by the established support planner.
 */
export function planCoordinatedAttack(
  state:MatchState,setup:MatchSetup,teamId:string,
  excludedIds:ReadonlySet<string>=new Set(),
):ReadonlyMap<string,CoordinatedAttackRun> {
  const result=new Map<string,CoordinatedAttackRun>()
  const carrier=state.players.find(p=>
    p.playerId===state.ball.controllerId && p.clubId===teamId)
  if(!carrier||carrier.formationSlot==='GK'||state.ball.outsidePitch ||
    state.ball.heightM>.5 || state.restart || state.offsideRestart ||
    state.foulRestart || state.periodKickoff || state.postGoalKickoff ||
    state.kickoff?.phase==='awaitingKick')return result
  const team=state.teams.find(t=>t.clubId===teamId)
  if(!team)return result
  const distanceToGoal=team.attackingDirection===1
    ?setup.pitch.lengthM-carrier.position.xM:carrier.position.xM
  if(distanceToGoal<12 || distanceToGoal>52)return result
  const teammates=state.players.filter(p=>p.clubId===teamId)
  const opponents=state.players.filter(p=>p.clubId!==teamId)
  const forward=(p:Point2)=>p.xM*team.attackingDirection
  const secondLast=opponents.map(p=>forward(p.position))
    .sort((a,b)=>b-a)[1]
  const offsideCeiling=Math.max(forward(carrier.position),
    secondLast??forward(carrier.position))-.7
  const excluded=new Set(excludedIds)
  excluded.add(carrier.playerId)
  const reserved:Point2[]=[]
  // Finishing opportunities belong to the best open runner, not a
  // compulsory striker. Winger and late-arriving midfielder go first.
  const roles:CoordinatedRunRole[]=[
    'insideForward','midfieldArrival','strikerLink',
    'wideOutlet','fullbackSupport',
  ]
  let penetrating=0
  for(const role of roles){
    if(role==='wideOutlet' && result.size===0)continue
    if(role==='fullbackSupport' && result.size===0)continue
    if(role==='insideForward' && penetrating>=2 ||
      role==='midfieldArrival' && penetrating>=2)continue
    const proposal=chooseRole(role,state,setup,carrier,
      teammates,opponents,reserved,excluded,offsideCeiling)
    if(!proposal)continue
    // Prefer complementary attacking roles, with a hard cap on 3
    // advanced runners. Fullback is support, never a second box invader.
    if(role==='strikerLink' && penetrating>=3)continue
    result.set(proposal.playerId,{
      playerId:proposal.playerId,target:proposal.target,role,
      utilityBonus:proposal.utilityBonus,
      clearanceM:proposal.clearanceM,
    })
    excluded.add(proposal.playerId)
    reserved.push(proposal.target)
    if(role==='insideForward'||role==='midfieldArrival'||
      role==='strikerLink')penetrating++
  }
  return result
}
