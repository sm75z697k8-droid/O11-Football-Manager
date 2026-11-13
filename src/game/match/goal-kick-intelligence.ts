import type { MatchSetup } from '../model/match'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { MatchState, OutOfPlayEvent, PlayerMatchState } from './state'

/**
 * GK-S1: deterministic, pressure-aware goal-kick build-out planning.
 * This proposes positions and targets only: existing locomotive movement,
 * real ball contacts, referee constraints and seeded kick errors stay in charge.
 * Distances/thresholds are simulator estimates, not live match telemetry.
 */
export const GOAL_KICK_INTELLIGENCE_VERSION = 'realistic-goalkick-buildout-gk-s1-v1'
const clamp = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v))
const dist = (a:Point2,b:Point2) => Math.hypot(a.xM-b.xM,a.yM-b.yM)
const direction = (event:OutOfPlayEvent):1|-1 =>
  event.side==='left'?1:-1
const goalX = (event:OutOfPlayEvent,pitch:PitchDefinition) =>
  event.side==='left'?0:pitch.lengthM
const pointFromGoal = (
  event:OutOfPlayEvent,pitch:PitchDefinition,depth:number,yM:number,
):Point2=>({
  xM:clamp(goalX(event,pitch)+direction(event)*depth,2.5,pitch.lengthM-2.5),
  yM:clamp(yM,2.5,pitch.widthM-2.5),
})
const flank = (p:PlayerMatchState,event:OutOfPlayEvent):number =>
  (['RB','RCB','RCM','RW'].includes(p.formationSlot)?1:
    ['LB','LCB','LCM','LW'].includes(p.formationSlot)?-1:0)*direction(event)

/** Keep defenders and the 6 available during build-up. Other outfielders
 * create meaningful second/third lines instead of becoming frozen markers.
 * Targets never reposition a player instantly.
 */
export function goalKickBuildOutTarget(
  player:PlayerMatchState,event:OutOfPlayEvent,setup:MatchSetup,
):Point2 | null {
  const c=setup.pitch.widthM/2
  const side=flank(player,event)
  switch(player.formationSlot){
    case 'RB':case 'LB':
      return pointFromGoal(event,setup.pitch,25,c+side*24)
    case 'DM':
      return pointFromGoal(event,setup.pitch,26,c)
    case 'RCM':case 'LCM':
      return pointFromGoal(event,setup.pitch,38,c+side*12)
    case 'RW':case 'LW':
      return pointFromGoal(event,setup.pitch,53,c+side*22)
    case 'ST':
      return pointFromGoal(event,setup.pitch,55,c)
    default:return null
  }
}

export function goalKickOpponentTarget(
  player:PlayerMatchState,event:OutOfPlayEvent,setup:MatchSetup,
  pressing:'low'|'standard'|'high',
):Point2 {
  const p=setup.pitch
  const depth=event.side==='left'
    ?player.position.xM:p.lengthM-player.position.xM
  const inside=depth>=0 && depth<p.penaltyAreaDepthM &&
    Math.abs(player.position.yM-p.widthM/2)<p.penaltyAreaWidthM/2
  const c=p.widthM/2
  const side=flank(player,event)
  const screen=pressing==='high'
    ? ['ST','RW','LW'].includes(player.formationSlot)
    : pressing==='standard' && player.formationSlot==='ST'
  const wanted=screen
    ? pointFromGoal(event,p,
      p.penaltyAreaDepthM+(pressing==='high'?3.2:6),
      c+(player.formationSlot==='ST'?0:side*13))
    : player.position
  if(screen && dist(player.position,wanted)<26)return wanted
  if(!inside)return player.position
  // No attacker starts inside the box on a deliberately staged goal kick.
  // Retreat by actual locomotion, not a referee-induced teleport.
  return pointFromGoal(event,p,p.penaltyAreaDepthM+1.7,
    player.position.yM)
}

const nearest = (p:Point2,players:readonly PlayerMatchState[]) =>
  players.reduce((d,player)=>Math.min(d,dist(p,player.position)),100)

function laneDanger(
  from:Point2,to:Point2,opponents:readonly PlayerMatchState[],
):number{
  const dx=to.xM-from.xM,dy=to.yM-from.yM
  const n=dx*dx+dy*dy
  if(n<.01)return 100
  let danger=0
  for(const p of opponents){
    const f=((p.position.xM-from.xM)*dx+
      (p.position.yM-from.yM)*dy)/n
    if(f<=.08||f>=.95)continue
    const d=Math.hypot(p.position.xM-from.xM-f*dx,
      p.position.yM-from.yM-f*dy)
    danger+=Math.max(0,4-d)*1.3
  }
  return danger
}

export interface GoalKickOption {
  readonly receiverId:string
  readonly target:Point2
  readonly type:'short'|'long'
  readonly opponentGapM:number
  readonly laneDanger:number
  readonly utility:number
}

/** Rate short receivers on their current physical positions, not arbitrary
 * formation points they have not reached. No made-up completed pass.
 *
 * Readiness applies only to short play; a long ball may target a real
 * midfielder further upfield without requiring the whole team to stand still.
 */
export function assessGoalKickOptions(
  state:MatchState,setup:MatchSetup,event:OutOfPlayEvent,
  ballSpot:Point2,shortOutlets:ReadonlyMap<string,Point2>,
):readonly GoalKickOption[]{
  if(event.kind!=='goalKick'||!event.awardedTeamId)return []
  const teammates=state.players.filter(p=>p.clubId===event.awardedTeamId)
  const opponents=state.players.filter(p=>p.clubId!==event.awardedTeamId)
  const options:GoalKickOption[]=[]
  const dir=direction(event)
  const goalLine=goalX(event,setup.pitch)
  for(const player of teammates){
    if(player.formationSlot==='GK')continue
    const depth=(player.position.xM-goalLine)*dir
    const d=dist(ballSpot,player.position)
    if(depth<=setup.pitch.goalAreaDepthM+3||d<7||d>46)continue
    const space=nearest(player.position,opponents)
    const obstruction=laneDanger(ballSpot,player.position,opponents)
    const def=setup.players.find(p=>p.id===player.playerId)
    if(!def)throw new Error('Missing goal-kick receiving definition')
    const skills=def.abilities
    const reception=(.46*skills.technical.firstTouch+
      .24*skills.mental.composure+
      .20*skills.mental.anticipation+
      .10*skills.physical.agility)/100
    const shortTarget=shortOutlets.get(player.playerId)
    const availableShort=!!shortTarget &&
      dist(player.position,shortTarget)<
        (['RCB','LCB'].includes(player.formationSlot)?2.4:3.2) &&
      d<=32
    if(availableShort){
      const pressure=Math.max(0,5.3-space)
      const utility=22+Math.min(space,12)*1.5-
        obstruction*4.8-pressure*4.5-d*.16+reception*5.2+
        (['RCB','LCB'].includes(player.formationSlot)?1.1:0)
      options.push({receiverId:player.playerId,
        target:{...player.position},type:'short',
        opponentGapM:space,laneDanger:obstruction,utility})
    }
    if(['DM','RCM','LCM','RW','LW','ST'].includes(player.formationSlot) &&
        d>=25 && d<=46){
      const pressure=Math.max(0,4.2-space)
      // The ball might be physically intercepted or lost aerially: no
      // artificial bonus for an assumed successful long distribution.
      const utility=12+Math.min(space,12)*.95-
        obstruction*1.4-pressure*2.6-
        Math.abs(d-34)*.35+reception*5+
        (player.formationSlot==='DM'?1:0)
      options.push({receiverId:player.playerId,
        target:{...player.position},type:'long',
        opponentGapM:space,laneDanger:obstruction,utility})
    }
  }
  return options.sort((a,b)=>b.utility-a.utility ||
    a.receiverId.localeCompare(b.receiverId) ||
    a.type.localeCompare(b.type))
}

export function chooseGoalKickOption(
  choices:readonly GoalKickOption[],elapsedTicks:number,
):GoalKickOption|null {
  const safeShort=choices.find(c=>c.type==='short' &&
    c.opponentGapM>=5.3 && c.laneDanger<1.4)
  if(safeShort)return safeShort
  const long=choices.find(c=>c.type==='long' &&
    c.opponentGapM>=3.5)
  if(long)return long
  const short=choices.find(c=>c.type==='short')
  if(short)return short
  // Unreached full-back/centre-back targets must not freeze the match
  // indefinitely; keep a deliberately fallible long outlet available.
  if(elapsedTicks>=65)return choices[0]??null
  return null
}
