import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState } from '../match/state'
import { advanceBallPhysics, BALL_RADIUS_M } from '../physics/ball'
import { deriveMotionLimits } from '../physics/locomotion'
import { outfieldHeaderReach } from '../physics/aerial-heading'
import { activeAerialDelivery } from './goalkeeper-aerial'

/** COR-S1: real moving-air-ball interception positions for BOTH teams.
 * Tactical targets do not move or jump a player; 50ms locomotion and the
 * shared swept ball collision still have to get the real contact right.
 */
export const AERIAL_DUEL_AI_VERSION = 'timed-header-intercepts-cor-s1-v1'
const LOOKAHEAD_TICKS=42
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))

export interface AerialDuelAssignment {
  readonly playerId:string
  readonly teamId:string
  readonly target:Point2
  readonly arrivalSeconds:number
  readonly score:number
}

/**
 * A heading contest needs a confirmed lofted wide kick or real corner,
 * not any airborne diagnostic ball. GK claiming uses the same delivery
 * detector. The last actual kicker remains the provenance until someone
 * makes a new physical contact.
 */
export function activeOutfieldAerialDelivery(
  state:MatchState,setup:MatchSetup,
):{kickerId:string;kickerClubId:string;kickTick:number}|null {
  if(state.restart || state.offsideRestart || state.foulRestart ||
      state.ball.controllerId!==null || state.ball.outsidePitch)
    return null
  const kicker=state.players.find(p=>p.playerId===state.ball.lastTouchPlayerId)
  if(!kicker)return null
  const defending=state.teams.find(t=>t.clubId!==kicker.clubId)
  if(!defending)return null
  const delivery=activeAerialDelivery(state,setup,defending)
  return delivery && delivery.kickerId===kicker.playerId
    ? {kickerId:kicker.playerId,kickerClubId:kicker.clubId,
       kickTick:delivery.kickTick}:null
}

/**
 * Scan the SAME ball integrator used by the real simulation. Choose a
 * physical intercept that the player could approach with their current
 * acceleration and energy, not a teleported landing dot or instant leap.
 */
export function planOutfieldAerialDuels(
  state:MatchState,setup:MatchSetup,
):ReadonlyMap<string,AerialDuelAssignment>{
  const source=activeOutfieldAerialDelivery(state,setup)
  const results=new Map<string,AerialDuelAssignment>()
  if(!source)return results
  const samples:{point:Point2;height:number;seconds:number}[]=[]
  let flight=state.ball
  for(let tick=1;tick<=LOOKAHEAD_TICKS;tick++){
    flight=advanceBallPhysics(flight,setup.pitch)
    if(flight.outsidePitch)break
    if(flight.heightM<=BALL_RADIUS_M+.04 &&
        flight.velocity.zMps<=0)break
    const inLeft=flight.position.xM <=setup.pitch.penaltyAreaDepthM+4
    const inRight=flight.position.xM >=
      setup.pitch.lengthM-setup.pitch.penaltyAreaDepthM-4
    if((inLeft||inRight)&&
      Math.abs(flight.position.yM-setup.pitch.widthM/2)<=
      setup.pitch.penaltyAreaWidthM/2+1.5){
      samples.push({point:{...flight.position},
        height:flight.heightM,seconds:tick*.05})
    }
  }
  if(!samples.length)return results
  const candidates:AerialDuelAssignment[]=[]
  for(const p of state.players){
    if(p.formationSlot==='GK' || p.playerId===source.kickerId ||
        !state.ai.enabledTeams[
          state.teams.findIndex(t=>t.clubId===p.clubId)])continue
    const def=setup.players.find(d=>d.id===p.playerId)
    if(!def)continue
    const limits=deriveMotionLimits(def,p.energy)
    const attrs=def.abilities
    let best:AerialDuelAssignment|null=null
    for(const sample of samples){
      const reach=outfieldHeaderReach(p,def,
        Math.min(.50,sample.seconds))
      if(sample.height<reach.minimumHeightM ||
          sample.height>reach.maximumHeightM)continue
      const gap=Math.hypot(sample.point.xM-p.position.xM,
        sample.point.yM-p.position.yM)
      // Acceleration-limited reachability. The extra time for reacting
      // prevents prediction from granting an immediate full-speed sprint.
      const available=sample.seconds-
        (.13+(100-attrs.mental.anticipation)*.0008)
      if(available<.12)continue
      const acceleration=limits.accelerationMps2
      const topSpeed=limits.maxSpeedMps
      const toTop=topSpeed/acceleration
      const rise=Math.min(available,toTop)
      const travel=(.5*acceleration*rise*rise+
        topSpeed*Math.max(0,available-toTop))*.82
      if(gap>travel+reach.horizontalM+.38)continue
      const score=40-gap*2.3-sample.seconds*2.2+
        attrs.technical.heading*.085+
        attrs.mental.anticipation*.043+
        attrs.physical.verticalLeap*.042-
        Math.max(0,sample.height-reach.baseHeadHeightM)*1.5
      const assignment:AerialDuelAssignment={
        playerId:p.playerId,teamId:p.clubId,
        target:{xM:clamp(sample.point.xM,.35,setup.pitch.lengthM-.35),
          yM:clamp(sample.point.yM,.35,setup.pitch.widthM-.35)},
        arrivalSeconds:sample.seconds,score,
      }
      if(!best||score>best.score)best=assignment
    }
    if(best)candidates.push(best)
  }
  // No more than two nominated aerial attackers and two defenders;
  // standing teammates don't all swarm the same bouncing ball.
  for(const team of state.teams){
    const ordered=candidates.filter(c=>c.teamId===team.clubId)
      .sort((a,b)=>b.score-a.score ||
        a.playerId.localeCompare(b.playerId))
    for(const candidate of ordered){
      if([...results.values()].filter(v=>v.teamId===team.clubId).length>=2)
        break
      if([...results.values()].some(v=>v.teamId===team.clubId &&
        Math.hypot(v.target.xM-candidate.target.xM,
          v.target.yM-candidate.target.yM)<1.3))continue
      results.set(candidate.playerId,candidate)
    }
  }
  return results
}
