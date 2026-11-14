import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, OffsidePhase, OffsideEvent } from './state'
import { BALL_RADIUS_M } from '../physics/ball'
import { FOOT_REACH_M } from '../physics/contact'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { scheduleMatchCommand } from './commands'

/** Law 11: metric coordinates and the actual team direction, never screen pixels.
 * A candidate is NOT an offence until active involvement at a subsequent touch.
 * Interference without a ball touch is not yet modelled.
 */
export const OFFSIDE_RULES_VERSION = 'law11-physical-touch-s16-v1'
export const FREE_KICK_CLEARANCE_M = 9.15
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const dist = (a: Point2, b: Point2) => Math.hypot(a.xM-b.xM,a.yM-b.yM)

/** Second-last opponent INCLUDING the goalkeeper. Returns null for an
 * incomplete team rather than treating a missing defender as a goal line.
 */
export function secondLastOpponentX(
  state: MatchState, teamId: string,
): number | null {
  const team = state.teams.find(t => t.clubId === teamId)
  if (!team) return null
  const values = state.players.filter(p => p.clubId !== teamId &&
    p.participation === 'onField')
    .map(p => p.position.xM * team.attackingDirection)
    .sort((a,b)=>b-a)
  return values.length >= 2 ? values[1]*team.attackingDirection : null
}

/** Strictly nearer the opponents' goal than BOTH ball and second-last
 * opponent, while in the opponents' half. Level is onside. */
export function isOffsidePosition(
  state: MatchState, setup: MatchSetup, teamId: string,
  position: Point2, ballPosition: Point2,
): boolean {
  const team = state.teams.find(t=>t.clubId===teamId)
  const line = secondLastOpponentX(state,teamId)
  if (!team || line === null) return false
  const forward = (x:number)=>x*team.attackingDirection
  const x=forward(position.xM)
  const inOpponentsHalf = team.attackingDirection===1
    ? position.xM>setup.pitch.lengthM/2+1e-7
    : position.xM<setup.pitch.lengthM/2-1e-7
  return inOpponentsHalf && x>forward(ballPosition.xM)+1e-7 &&
    x>forward(line)+1e-7
}

export function offsideSnapshot(
  state: MatchState, setup: MatchSetup, passerId: string,
): OffsidePhase | null {
  const passer = state.players.find(p=>p.playerId===passerId)
  if (!passer) return null
  return {
    playedTick:state.clock.tick, passerId, attackingTeamId:passer.clubId,
    playerIds:state.players.filter(p=>p.clubId===passer.clubId &&
      p.playerId!==passerId &&
      isOffsidePosition(state,setup,passer.clubId,p.position,state.ball.position))
      .map(p=>p.playerId),
  }
}

type RealTouch = {playerId:string; outcome:string; type:'manual'|'automatic'; kind?:string}
/** Both commanded foot contacts and genuinely swept contacts count.
 * A defender's uncontrolled deflection/parry does NOT reset the phase;
 * a deliberate controlled interception or kick does.
 */
function touchesAtTick(state: MatchState): RealTouch[] {
  const tick=state.clock.tick
  // Match histories grow over ninety minutes. Only inspect the TAIL, not
  // thousands of previous touches on every 50ms Safari physics tick.
  const current: RealTouch[]=[]
  for(let i=state.contactEvents.length-1;i>=0;i--){
    const e=state.contactEvents[i]
    if(e.tick<tick) break
    if(e.tick!==tick || !['controlled','miscontrolled','kicked','thrown',
      'thrownIn','goalKicked','cornerKicked'].includes(e.outcome)) continue
    current.push({playerId:e.playerId,outcome:e.outcome,
      type:'manual',kind:e.kind})
  }
  current.reverse() // Manual commands resolve in their actual application order.
  const latest=state.automaticContactEvents.at(-1)
  if(latest?.tick===tick && latest.outcome!=='heldOff')
    current.push({playerId:latest.playerId,outcome:latest.outcome,
      type:'automatic'})
  return current
}

export function applyOffsideLaw(
  before: MatchState, after: MatchState, setup: MatchSetup,
): MatchState {
  if (before.ball.outsidePitch || before.offsideRestart ||
      before.restart || before.foulRestart ||
      before.postGoalKickoff || before.periodKickoff ||
      before.kickoff?.phase==='awaitingKick') return after
  const touches=touchesAtTick(after)
  if(!touches.length) return after.ball.outsidePitch && after.offsidePhase
    ? {...after,offsidePhase:null} : after
  let phase=before.offsidePhase
  let indirect=before.indirectFreeKick
  for (const touch of touches) {
    const player=after.players.find(p=>p.playerId===touch.playerId)
    if (!player) continue
    // The free kick becomes direct after any genuine touch by ANOTHER player.
    if (indirect && touch.playerId!==indirect.takerId) indirect=null
    // Law 11 exempts direct receptions from these three specific restarts.
    // The subsequent recipient's NEXT genuine play can create a new phase.
    const exempt=touch.type==='manual' &&
      ['throwIn','goalKick','cornerKick'].includes(touch.kind ?? '')
    const deliberate=touch.type==='manual' &&
      ['controlled','miscontrolled','kicked','thrown','thrownIn','goalKicked',
        'cornerKicked'].includes(touch.outcome) ||
      touch.type==='automatic' &&
      ['intercepted','wonChallenge','caught','headed'].includes(touch.outcome)
    if (phase && player.clubId===phase.attackingTeamId &&
        phase.playerIds.includes(player.playerId)) {
      const awarded=after.teams.find(t=>t.clubId!==player.clubId)
      if (!awarded) throw new Error('Offside requires the opposing club')
      const spot={xM:clamp(player.position.xM,BALL_RADIUS_M,
          setup.pitch.lengthM-BALL_RADIUS_M),
        yM:clamp(player.position.yM,BALL_RADIUS_M,
          setup.pitch.widthM-BALL_RADIUS_M)}
      const taker=after.players.filter(p=>p.clubId===awarded.clubId &&
        p.formationSlot!=='GK')
        .sort((a,b)=>dist(a.position,spot)-dist(b.position,spot) ||
          a.playerId.localeCompare(b.playerId))[0]
      if (!taker) throw new Error('No player available for the indirect free kick')
      const offence:OffsideEvent={
        tick:after.clock.tick,playedTick:phase.playedTick,
        passerId:phase.passerId,offenderId:player.playerId,
        awardedTeamId:awarded.clubId,takerId:taker.playerId,spot,
      }
      return {...after,
        offsidePhase:null,offsideRestart:offence,indirectFreeKick:null,
        offsideEvents:[...after.offsideEvents,offence],
        ball:{...after.ball,position:spot,heightM:BALL_RADIUS_M,
          velocity:{xMps:0,yMps:0,zMps:0},outsidePitch:false,
          controllerId:null,controlOffset:null},
        ai:{...after.ai,passIntent:null,decisionSnapshot:[]},
      }
    }
    if (exempt) { phase=null; continue }
    if (deliberate) {
      // Preserve phase on an opponent's accidental rebound, but replace it
      // on their actual controlled play. A keeper's save/parry is not deliberate.
      phase=offsideSnapshot(after,setup,player.playerId)
    }
  }
  // Any whole-ball exit or legally scored goal ends this attacking phase.
  if (after.ball.outsidePitch) phase=null
  return {...after,offsidePhase:phase,indirectFreeKick:indirect}
}

export function offsideKickPrefix(tick:number):string {
  return 'ai-pass-offside-'+tick+'-'
}
export function offsideKickStationary(state:MatchState):boolean {
  const b=state.ball
  return !b.outsidePitch && b.controllerId===null &&
    b.heightM===BALL_RADIUS_M &&
    b.velocity.xMps===0 && b.velocity.yMps===0 && b.velocity.zMps===0
}
const inPenalty=(p:Point2,state:MatchState,setup:MatchSetup,teamId:string)=>{
  const team=state.teams.find(t=>t.clubId===teamId)
  if (!team) return false
  const back=team.attackingDirection===1?p.xM:
    setup.pitch.lengthM-p.xM
  return back<setup.pitch.penaltyAreaDepthM &&
    Math.abs(p.yM-setup.pitch.widthM/2)<setup.pitch.penaltyAreaWidthM/2
}
export function offsideOpponentsClear(state:MatchState,setup:MatchSetup):boolean {
  const ev=state.offsideRestart
  return !!ev && state.players.every(p=>p.clubId===ev.awardedTeamId ||
    (dist(p.position,ev.spot)>=FREE_KICK_CLEARANCE_M-.02 &&
    (!inPenalty(ev.spot,state,setup,ev.awardedTeamId) ||
      !inPenalty(p.position,state,setup,ev.awardedTeamId))))
}

/** The free kick is a stationary REAL foot strike. The taker and opponents
 * travel there through existing locomotion; nobody is teleported in open play.
 */
export function stageOffsideRestart(state:MatchState,setup:MatchSetup):MatchState {
  const ev=state.offsideRestart
  if (!ev) return state
  const teamIndex=state.teams.findIndex(t=>t.clubId===ev.awardedTeamId)
  if (teamIndex<0 || !state.ai.enabledTeams[teamIndex]) return state
  const direction=state.teams[teamIndex].attackingDirection
  const targetTaker={
    xM:clamp(ev.spot.xM-direction*.55,.3,setup.pitch.lengthM-.3),
    yM:ev.spot.yM,
  }
  const players=state.players.map(p=>{
    const enabled=state.ai.enabledTeams[state.teams.findIndex(t=>t.clubId===p.clubId)]
    if (!enabled) return p
    let target:Point2=p.position
    if (p.playerId===ev.takerId) target=targetTaker
    else if(p.clubId!==ev.awardedTeamId){
      const d=dist(p.position,ev.spot)
      const mustLeaveArea=inPenalty(ev.spot,state,setup,ev.awardedTeamId) &&
        inPenalty(p.position,state,setup,ev.awardedTeamId)
      if (d<FREE_KICK_CLEARANCE_M+.35 || mustLeaveArea) {
        const dx=p.position.xM-ev.spot.xM
        const dy=p.position.yM-ev.spot.yM
        const nx=d>.01?dx/d:direction
        const ny=d>.01?dy/d:0
        target={
          xM:clamp(ev.spot.xM+nx*(FREE_KICK_CLEARANCE_M+1.2),
            .3,setup.pitch.lengthM-.3),
          yM:clamp(ev.spot.yM+ny*(FREE_KICK_CLEARANCE_M+1.2),
            .3,setup.pitch.widthM-.3),
        }
        if(mustLeaveArea){
          // Choose a point BOTH outside the penalty area AND ten yards
          // from the spot; stopping exactly at the area line can leave
          // an opponent illegally close and freeze the indirect free kick.
          const forwardClearance=FREE_KICK_CLEARANCE_M+1.3
          const x=direction===1
            ? Math.max(setup.pitch.penaltyAreaDepthM+1,
                ev.spot.xM+forwardClearance)
            : Math.min(setup.pitch.lengthM-setup.pitch.penaltyAreaDepthM-1,
                ev.spot.xM-forwardClearance)
          target={...target,xM:clamp(x,.3,setup.pitch.lengthM-.3)}
        }
        if(dist(target,ev.spot)<FREE_KICK_CLEARANCE_M+.05){
          // A touchline or goal line can clamp a radial retreat too close
          // to the ball. Always offer a reachable infield alternative.
          const towardCentre=ev.spot.xM<=setup.pitch.lengthM/2?1:-1
          target={
            xM:clamp(ev.spot.xM+towardCentre*
              (FREE_KICK_CLEARANCE_M+1.4),.3,setup.pitch.lengthM-.3),
            yM:ev.spot.yM,
          }
        }
      }
    }else{
      const anchor=state.ai.formationPositions[p.playerId]??p.position
      target={xM:clamp(anchor.xM+direction*4,.3,
        setup.pitch.lengthM-.3),yM:anchor.yM}
    }
    if(dist(p.position,target)<.12 &&
      p.velocity.xMps===0 && p.velocity.yMps===0) return p
    return {...p,engagesBall:false,
      intention:{kind:'moveToPoint' as const,sinceTick:state.clock.tick,target}}
  })
  let staged:MatchState={...state,players,
    ai:{...state.ai,passIntent:null,decisionSnapshot:[]}}
  const taker=players.find(p=>p.playerId===ev.takerId)
  const prefix=offsideKickPrefix(ev.tick)
  const pending=state.pendingCommands.some(c=>c.commandId.startsWith(prefix))
  if (taker && !pending && state.clock.tick-ev.tick>=14 &&
      dist(taker.position,ev.spot)<=FOOT_REACH_M-.04 &&
      offsideOpponentsClear(staged,setup) &&
      offsideKickStationary(staged)) {
    const receiver=players.filter(p=>p.clubId===ev.awardedTeamId &&
      p.playerId!==ev.takerId).sort((a,b)=>{
        const da=dist(a.position,ev.spot), db=dist(b.position,ev.spot)
        const sa=da<3||da>38?1000:da-
          (a.position.xM-ev.spot.xM)*direction*.12
        const sb=db<3||db>38?1000:db-
          (b.position.xM-ev.spot.xM)*direction*.12
        return sa-sb || a.playerId.localeCompare(b.playerId)
      })[0]
    const target=receiver?{...receiver.position}:{
      xM:clamp(ev.spot.xM+direction*14,1,setup.pitch.lengthM-1),
      yM:ev.spot.yM,
    }
    const result=scheduleMatchCommand(staged,{
      commandId:prefix+ev.takerId,teamId:ev.awardedTeamId,
      type:'attemptKick',playerId:ev.takerId,target,
      power:.34,lift:0,
    },setup.pitch)
    if(result.receipt.accepted){
      staged={...result.state,ai:{...staged.ai,
        lastPassTick:state.clock.tick}}
    }
  }
  return staged
}
export function advanceOffsideRestart(
  state:MatchState,setup:MatchSetup,
  resolveContact:(state:MatchState,setup:MatchSetup)=>MatchState,
):MatchState {
  const staged=stageOffsideRestart(state,setup)
  const moved=advancePlayerLocomotion(staged,setup.players,setup.pitch)
  const contacted=resolveContact(moved,setup)
  const restart=contacted.offsideRestart
  if(!restart) return contacted
  const kicked=contacted.contactEvents.find(e=>e.tick===contacted.clock.tick &&
    e.outcome==='kicked' && e.playerId===restart.takerId &&
    e.commandId.startsWith(offsideKickPrefix(restart.tick)))
  if(!kicked) return contacted
  // Free kick is indirect until somebody else physically touches the ball.
  return {...contacted,offsideRestart:null,
    indirectFreeKick:{takerId:restart.takerId,kickedTick:contacted.clock.tick},
    offsidePhase:offsideSnapshot(contacted,setup,restart.takerId)}
}
