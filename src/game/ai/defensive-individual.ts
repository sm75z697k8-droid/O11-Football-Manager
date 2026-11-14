import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, TeamMatchState } from '../match/state'
import { boundedTarget, separationM } from './coordination'

/**
 * DEF-F1: individualized OFF-BALL defensive reasoning on one authoritative
 * shared snapshot. Tactical geometry is estimated, NOT real tracking data.
 * Intent never wins a tackle, intercepts a pass, or moves a player directly:
 * the usual player locomotion and ball-contact engines stay authoritative.
 *
 * Pressers, the nominated covering player, keeper and aerial challenges
 * are still handled by their existing higher-priority planners.
 */
export const INDIVIDUAL_DEFENCE_VERSION = 'individual-threat-matching-def-f1-v1'
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))
const dist = separationM

type DefensiveRole = 'RCB'|'LCB'|'RB'|'LB'|'DM'|'RCM'|'LCM'|'RW'|'LW'|'ST'
type OutfieldRole = DefensiveRole
export interface IndividualDefensiveResponse {
  readonly action: 'mark' | 'recover'
  readonly target: Point2
  /** Informational only: the marker is not granted any physical contact. */
  readonly threatPlayerId: string | null
}
export interface DefensiveThreatMatch {
  readonly defenderId: string
  readonly threatId: string
  readonly score: number
  readonly target: Point2
}

function centreBack(slot: string): boolean {
  return slot==='RCB'||slot==='LCB'
}
function fullBack(slot: string): boolean {
  return slot==='RB'||slot==='LB'
}
function playerSkills(setup: MatchSetup,
  player: PlayerMatchState) {
  const def=setup.players.find(d=>d.id===player.playerId)
  if(!def)throw new Error('Individual defender missing definition')
  const a=def.abilities
  const awareness=(.38*a.mental.defensivePositioning+
    .27*a.mental.anticipation+.22*a.mental.decisions+
    .13*a.mental.teamwork)/100
  return {awareness,marking:a.technical.marking/100,
    workRate:a.mental.workRate/100,
    holds: def.tendencies.includes('holdsPosition'),
    energy:player.energy/100}
}

function projectedThreat(
  setup:MatchSetup,player:PlayerMatchState,awareness:number,
):Point2{
  // A footballer's OWN anticipation affects how far they expect
  // an opponent to run. This is bounded future position, not a
  // teleport or a forced defender/player engagement.
  const horizon=.20+awareness*.40
  return {
    xM:clamp(player.position.xM+player.velocity.xMps*horizon,
      .35,setup.pitch.lengthM-.35),
    yM:clamp(player.position.yM+player.velocity.yMps*horizon,
      .35,setup.pitch.widthM-.35),
  }
}

/** Role-specific suitability. A fullback should not casually abandon the
 * touchline to mark the opposing striker while their winger runs free.
 * A central defender values dangerous central runners, a DM passes lanes,
 * and a winger supports rather than duplicating the central marking.
 */
function roleFit(
  player:PlayerMatchState, original:Point2,
  opponent:PlayerMatchState, projected:Point2,
  setup:MatchSetup,
):number {
  const slot=player.formationSlot as OutfieldRole
  const targetSlot=opponent.formationSlot
  const centre=setup.pitch.widthM/2
  const offCentre=Math.abs(projected.yM-centre)
  const flank=Math.sign(original.yM-centre)
  const otherFlank=Math.sign(projected.yM-centre)
  if(slot==='ST')return -100
  if(centreBack(slot))return 5.6-offCentre*.28+
    (targetSlot==='ST'?5:
      targetSlot==='RW'||targetSlot==='LW'?-2:0)
  if(fullBack(slot)){
    if(flank!==0&&otherFlank!==0&&flank!==otherFlank)
      return -14
    return (offCentre>=8?5:0)+
      (targetSlot==='RW'||targetSlot==='LW'?4:0)-
      Math.abs(offCentre-16)*.13
  }
  if(slot==='DM')return 4.7-offCentre*.22+
    (targetSlot==='RCM'||
      targetSlot==='LCM'?3:0)
  if(slot==='RCM'||slot==='LCM'){
    const side=flank===0?1:flank
    return 3.5-offCentre*.16+
      (otherFlank===side?2:-1)+
      (targetSlot==='RCM'||
        targetSlot==='LCM'?2:0)
  }
  if(slot==='RW'||slot==='LW'){
    if(flank!==0&&otherFlank!==0&&flank!==otherFlank)
      return -12
    return 1.2+offCentre*.10+
      (targetSlot==='RB'||targetSlot==='LB'?2:0)
  }
  return -3
}

/** Calculate a plausible goal-side shadow target, but stay near the
 * existing team recovery point. No magnetized opponent following:
 * high positioning keeps a disciplined zone and more intelligent players
 * look farther along the actual runner's movement.
 */
function boundedMarkPosition(
  player:PlayerMatchState,block:Point2,
  threat:Point2,team:TeamMatchState,setup:MatchSetup,
  awareness:number,holds:boolean,
):Point2 {
  const goalSide=2.0+awareness*.8
  const desired={
    xM:threat.xM-team.attackingDirection*goalSide,
    yM:threat.yM+(block.yM-threat.yM)*.12,
  }
  const delta=dist(block,desired)
  const travel=holds?4.3:5.5+awareness*2.4
  const fraction=delta<=travel?1:travel/delta
  const target=boundedTarget({
    xM:block.xM+(desired.xM-block.xM)*fraction,
    yM:block.yM+(desired.yM-block.yM)*fraction,
  },setup.pitch)
  // Last-line centre-backs may challenge a *close* runner, but must not
  // cross the ball and leave the whole goal unprotected.
  return centreBack(player.formationSlot)
    ? boundedTarget({
        ...target,xM:team.attackingDirection===1
          ?Math.min(target.xM,threat.xM-1.3)
          :Math.max(target.xM,threat.xM+1.3),
      },setup.pitch)
    :target
}

/**
 * Individual fallback when nobody is dangerous enough to mark.
 * Different roles read different SPACE rather than copying an identical
 * ball-following translation: centre-backs hold the line, full-backs
 * protect channels, DM screens the central lane, midfielders protect
 * nearby half-spaces, wingers support wide traps and ST blocks recycling.
 */
export function individualDefensiveRecovery(
  state:MatchState,setup:MatchSetup,team:TeamMatchState,
  player:PlayerMatchState,original:Point2,block:Point2,ball:Point2,
  threats:readonly PlayerMatchState[],
):Point2 {
  if(player.formationSlot==='GK')return block
  const slot=player.formationSlot as DefensiveRole
  const {awareness,holds,energy}=playerSkills(setup,player)
  const weight=clamp((.65+awareness*.52)*(.8+energy*.2)*
    (holds?.42:1),.18,1.2)
  const centre=setup.pitch.widthM/2
  const side=Math.sign(original.yM-centre)||1
  const ballSide=Math.sign(ball.yM-centre)||1
  const eligible=threats.filter(t=>t.playerId!==state.ball.controllerId)
  const nearest=(predicate:(p:PlayerMatchState)=>boolean)=>{
    let best:PlayerMatchState|null=null
    let score=Infinity
    for(const o of eligible){
      if(!predicate(o))continue
      const d=dist(o.position,block)
      if(d<score){best=o;score=d}
    }
    return best
  }
  let x=block.xM,y=block.yM
  if(centreBack(slot)){
    const central=nearest(o=>Math.abs(o.position.yM-centre)<13 &&
      dist(o.position,block)<19)
    if(central){
      const p=projectedThreat(setup,central,awareness)
      y+=clamp((p.yM-block.yM)*.20,-2.2,2.2)*weight
    } else {
      y+=clamp((ball.yM-centre)*.06,-1.1,1.1)*weight
    }
  } else if(fullBack(slot)){
    const runner=nearest(o=>
      Math.sign(o.position.yM-centre)===side&&
      dist(o.position,block)<20)
    const sameFlank=side===ballSide
    y+=clamp(
      runner ? (runner.position.yM-block.yM)*.27 :
        (sameFlank ? side*2.2 : -side*1.3),
      -3.5,3.5)*weight
    // Respect a wide runner breaking behind the outside defender.
    if(runner && runner.velocity.xMps*team.attackingDirection<-.9)
      x-=team.attackingDirection*1.5*weight
  } else if(slot==='DM'){
    const central=nearest(o=>Math.abs(o.position.yM-centre)<17 &&
      dist(o.position,block)<24)
    const reference=central?.position.yM??ball.yM
    y+=clamp((reference-block.yM)*.25,-3,3)*weight
    // Remain between the ball and goal, screening rather than lunging.
    x+=team.attackingDirection*clamp(
      (ball.xM-block.xM)*team.attackingDirection*.12,0,2.3)*weight
  } else if(slot==='RCM'||slot==='LCM'){
    const rival=nearest(o=>
      Math.sign(o.position.yM-centre)===side&&
      dist(o.position,block)<20)
    const reference=rival?.position.yM??ball.yM
    y+=clamp((reference-block.yM)*.21,-3.4,3.4)*weight
    if(rival&&rival.velocity.xMps*team.attackingDirection<-.8)
      x-=team.attackingDirection*.9*weight
  } else if(slot==='RW'||slot==='LW'){
    // Far winger narrows against switches; ball-side winger supports the
    // full-back's trap, not the centre-back's mark.
    y+=(side===ballSide?side*1.8:-side*2.4)*weight
  } else if(slot==='ST'){
    // Screen central outlets without rushing toward the owner.
    const pivot=nearest(o=>o.formationSlot==='DM'||o.formationSlot==='RCM'||
      o.formationSlot==='LCM')
    y+=clamp(((pivot?.position.yM??ball.yM)-block.yM)*.18,
      -2.3,2.3)*weight
  }
  const target=boundedTarget({xM:x,yM:y},setup.pitch)
  // Small, role-specific instructions, NOT an opportunity to break the
  // defending block or drift outside the 8m marking displacement guard.
  const deviation=dist(block,target)
  return deviation<=4.3?target:boundedTarget({
    xM:block.xM+(target.xM-block.xM)*4.3/deviation,
    yM:block.yM+(target.yM-block.yM)*4.3/deviation,
  },setup.pitch)
}

/** Globally score defender ↔ opponent pairings before assignment.
 * This prevents GK/RB/CB source-order priority from stealing a striker's
 * obvious matchup from the appropriate defender. One opponent is not
 * assigned to three different markers; all others screen or recover.
 */
export function planIndividualDefensiveResponses(
  state:MatchState,setup:MatchSetup,team:TeamMatchState,
  ballPoint:Point2,participants:readonly PlayerMatchState[],
  threats:readonly PlayerMatchState[],
  blocks:ReadonlyMap<string,Point2>,
):ReadonlyMap<string,IndividualDefensiveResponse>{
  const pairs:DefensiveThreatMatch[]=[]
  for(const player of participants){
    const original=state.ai.formationPositions[player.playerId]
    const block=blocks.get(player.playerId)
    if(!original||!block)
      throw new Error('Individual defender missing formation point')
    if(player.formationSlot==='GK'||player.formationSlot==='ST')
      continue
    const {awareness,marking,holds}=playerSkills(setup,player)
    const previous=state.ai.decisionSnapshot.find(d=>
      d.playerId===player.playerId&&d.action==='mark')
    for(const opponent of threats){
      if(opponent.playerId===state.ball.controllerId)continue
      const predicted=projectedThreat(setup,opponent,awareness)
      const gap=dist(block,predicted)
      if(gap>13.2)continue
      const fit=roleFit(player,original,opponent,predicted,setup)
      const roleLimit=fullBack(player.formationSlot)||centreBack(player.formationSlot)
        ?-7:-5
      if(fit<roleLimit)continue
      const target=boundedMarkPosition(
        player,block,predicted,team,setup,awareness,holds)
      const towardGoal=opponent.velocity.xMps*
        team.attackingDirection<-.9?1.4:0
      const continuity=previous&&dist(previous.target,target)<3.4
        ?1.8:0
      const score=7.8+fit-gap*.66-
        dist(player.position,predicted)*.08+
        awareness*2.2+marking*2.1+towardGoal+continuity
      if(score<5.1)continue
      pairs.push({defenderId:player.playerId,
        threatId:opponent.playerId,score,target})
    }
  }
  pairs.sort((a,b)=>b.score-a.score ||
    a.defenderId.localeCompare(b.defenderId) ||
    a.threatId.localeCompare(b.threatId))
  const marked=new Set<string>()
  const output=new Map<string,IndividualDefensiveResponse>()
  // Do not turn eleven footballers into eleven magnetic man-markers.
  // A maximum of 4 credible simultaneous marks leaves positional
  // screen/recovery jobs and the existing first presser/cover unchanged.
  for(const pair of pairs){
    if(marked.size>=4)break
    if(output.has(pair.defenderId)||marked.has(pair.threatId))continue
    output.set(pair.defenderId,{action:'mark',
      target:pair.target,threatPlayerId:pair.threatId})
    marked.add(pair.threatId)
  }
  for(const player of participants){
    if(output.has(player.playerId))continue
    const original=state.ai.formationPositions[player.playerId]!
    const block=blocks.get(player.playerId)!
    output.set(player.playerId,{action:'recover',threatPlayerId:null,
      target:individualDefensiveRecovery(
        state,setup,team,player,original,block,ballPoint,threats)})
  }
  if(output.size!==participants.length)
    throw new Error('Individual defensive assignments incomplete')
  return output
}
