import type { MatchSetup } from '../model/match'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { BallMatchState, MatchState, OutOfPlayEvent, PlayerMatchState } from './state'
import { BALL_RADIUS_M, advanceBallPhysics } from '../physics/ball'
import { throwInFlightVelocity, THROW_IN_LAUNCH_HEIGHT_M } from '../physics/throw-in-flight'
import { advancePlayerLocomotion, deriveMotionLimits, wrapRadians } from '../physics/locomotion'
import { scheduleMatchCommand } from './commands'
import { goalKickSpot } from './goal-kicks'
import { cornerBallSpot } from './corners'

/**
 * S1.1: genuine touchline awards and deliberate legal throw-in releases.
 * This is an incremental restart foundation; corners and goal kicks are
 * classified but left as explicit stoppages until their own restart rules.
 */
export const OUT_OF_PLAY_VERSION = 'legal-throw-in-staging-deadlock-thr-f2-v1'
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

type Edge = OutOfPlayEvent['side']
interface EdgeCrossing {
  readonly side: Edge
  readonly fraction: number
  readonly point: Point2
}

/** The earliest crossed PAINTED line, used only after the whole ball is
 * physically outside. This avoids incorrectly awarding a throw when a
 * diagonal kick crossed a goal line first near the corner flag.
 */
function firstCrossedLine(
  from: Point2, to: Point2, pitch: PitchDefinition,
): EdgeCrossing | null {
  const edges: EdgeCrossing[] = []
  const consider = (side: Edge, coordinate: number,
    origin: number, end: number, isX: boolean) => {
    const delta = end - origin
    if (Math.abs(delta) < 1e-10) return
    const crossedOut = coordinate === 0 ? delta < 0 : delta > 0
    const extent = isX ? pitch.lengthM : pitch.widthM
    if (!crossedOut || coordinate !== (coordinate === 0 ? 0 : extent)) return
    const fraction = (coordinate - origin) / delta
    if (fraction < 0 || fraction > 1) return
    const xM = from.xM + (to.xM - from.xM) * fraction
    const yM = from.yM + (to.yM - from.yM) * fraction
    // Crossing past a corner along the already-extended line still
    // belongs to whichever line was reached first.
    edges.push({ side, fraction, point: { xM, yM } })
  }
  consider('left', 0, from.xM, to.xM, true)
  consider('right', pitch.lengthM, from.xM, to.xM, true)
  consider('top', 0, from.yM, to.yM, false)
  consider('bottom', pitch.widthM, from.yM, to.yM, false)
  edges.sort((a, b) => a.fraction - b.fraction ||
    a.side.localeCompare(b.side))
  if (edges.length) return edges[0]
  // A sphere can be partially outside the chalk without being wholly out
  // until a subsequent physics tick. In that case the first line was
  // crossed earlier; use the already-exterior axis.
  if (from.yM < 0 || from.yM > pitch.widthM) {
    const side = from.yM < 0 ? 'top' : 'bottom'
    return {
      side, fraction: 0,
      point: { xM: from.xM, yM: side === 'top' ? 0 : pitch.widthM },
    }
  }
  if (from.xM < 0 || from.xM > pitch.lengthM) {
    const side = from.xM < 0 ? 'left' : 'right'
    return {
      side, fraction: 0,
      point: { xM: side === 'left' ? 0 : pitch.lengthM, yM: from.yM },
    }
  }
  return null
}

function pickThrower(
  players: readonly PlayerMatchState[], teamId: string, spot: Point2,
): string {
  const candidates = players.filter(p =>
    p.clubId === teamId && p.formationSlot !== 'GK')
  candidates.sort((a, b) => {
    const distance = (p: PlayerMatchState) =>
      Math.hypot(p.position.xM - spot.xM, p.position.yM - spot.yM)
    const preferred = (p: PlayerMatchState) =>
      p.formationSlot === 'LB' || p.formationSlot === 'RB' ? 1.5 : 0
    return distance(a) - preferred(a) -
      (distance(b) - preferred(b)) ||
      a.playerId.localeCompare(b.playerId)
  })
  if (!candidates[0]) throw new Error('No outfield throw-in taker')
  return candidates[0].playerId
}

export function classifyOutOfPlay(
  before: MatchState, after: MatchState, setup: MatchSetup,
): OutOfPlayEvent | null {
  if (before.ball.outsidePitch || !after.ball.outsidePitch ||
      after.goalEvents.length > before.goalEvents.length) return null
  const lastTouch = after.players.find(p =>
    p.playerId === after.ball.lastTouchPlayerId)
  const edge = firstCrossedLine(
    before.ball.position, after.ball.position, setup.pitch)
  if (!edge) return null
  const { lengthM, widthM } = setup.pitch
  const touchline = edge.side === 'top' || edge.side === 'bottom'
  const spot = {
    xM: clamp(edge.point.xM, .35, lengthM - .35),
    yM: touchline ? edge.side === 'top' ? 0 : widthM :
      clamp(edge.point.yM, .35, widthM - .35),
  }
  let kind: OutOfPlayEvent['kind'] = 'unassigned'
  let awardedTeamId: string | null = null
  if (lastTouch) {
    if (touchline) {
      kind = 'throwIn'
      awardedTeamId = after.teams.find(t =>
        t.clubId !== lastTouch.clubId)?.clubId ?? null
    } else {
      const defending = after.teams.find(t =>
        t.attackingDirection === (edge.side === 'left' ? 1 : -1))
      if (!defending) throw new Error('No defending club at goal line')
      const defenderTouched = lastTouch.clubId === defending.clubId
      kind = defenderTouched ? 'corner' : 'goalKick'
      awardedTeamId = defenderTouched
        ? after.teams.find(t => t.clubId !== defending.clubId)?.clubId ?? null
        : defending.clubId
    }
  }
  const takerId = kind === 'throwIn' && awardedTeamId
    ? pickThrower(after.players, awardedTeamId, spot) : null
  return {
    tick: after.clock.tick, side: edge.side, spot,
    kind, awardedTeamId, lastTouchPlayerId: lastTouch?.playerId ?? null,
    takerId,
  }
}

/** Classification occurs only once after physical play and goal judging;
 * it does not presume a kick, change scores, or return ball possession.
 */
export function recordOutOfPlay(
  before: MatchState, after: MatchState, setup: MatchSetup,
): MatchState {
  const event = classifyOutOfPlay(before, after, setup)
  if (!event) return after
  if (event.kind === 'unassigned') {
    // Diagnostic ball launches have no legal last touch. Record geometry
    // without inventing a referee award or stopping the physics workload.
    return { ...after, outOfPlayEvents: [...after.outOfPlayEvents, event] }
  }
  const ball: BallMatchState = {
    ...after.ball,
    // A dead goal kick is placed inside the GOAL AREA, not left outside
    // or automatically handed to the keeper. Restarts block ordinary AI.
    position: event.kind === 'goalKick'
      ? goalKickSpot(event, setup.pitch) :
        event.kind === 'corner'
          ? cornerBallSpot(event, setup.pitch) : after.ball.position,
    outsidePitch: event.kind === 'goalKick' || event.kind === 'corner'
      ? false : after.ball.outsidePitch,
    controllerId: null, controlOffset: null,
    heightM: BALL_RADIUS_M,
    velocity: { xMps: 0, yMps: 0, zMps: 0 },
  }
  return {
    ...after, ball, restart: event, offsidePhase: null,
    indirectFreeKick: null,
    outOfPlayEvents: [...after.outOfPlayEvents, event],
    ai: { ...after.ai, passIntent: null, decisionSnapshot: [] },
  }
}

/** Laws 15 & 16: the restart kicker cannot play the ball a second time
 * until someone else has touched it. Reconstruct the LATEST touch from
 * real manual/automatic histories, so a later ordinary touch by the same
 * footballer is not incorrectly treated as the original throw.
 */
export function forbiddenRestartSecondTouch(
  state: MatchState, playerId: string,
): boolean {
  if (state.ball.lastTouchPlayerId !== playerId ||
      state.ball.controllerId !== null) return false
  let lastTick = -1
  let thrower = false
  for (let i = state.contactEvents.length - 1; i >= 0; i--) {
    const event = state.contactEvents[i]
    if (!['controlled', 'miscontrolled', 'kicked', 'thrown', 'thrownIn', 'goalKicked', 'cornerKicked']
      .includes(event.outcome)) continue
    lastTick = event.tick
    thrower = (event.outcome === 'thrownIn' ||
      event.outcome === 'goalKicked' ||
      event.outcome === 'cornerKicked' ||
      (event.outcome === 'kicked' &&
        (event.commandId.startsWith('ai-pass-postgoal-') ||
          event.commandId.startsWith('ai-pass-secondhalf-') ||
          event.commandId.startsWith('ai-pass-offside-') ||
          event.commandId.startsWith('ai-pass-foul-') ||
          event.commandId.startsWith('ai-shot-penalty-')))) &&
      event.playerId === playerId
    break
  }
  if (!thrower) return false
  for (let i = state.automaticContactEvents.length - 1; i >= 0; i--) {
    const event = state.automaticContactEvents[i]
    if (!['intercepted', 'deflected', 'wonChallenge',
      'caught', 'parried', 'punched'].includes(event.outcome)) continue
    // Automatic contacts occur after manual contacts within one tick.
    if (event.tick >= lastTick) return false
    break
  }
  return true
}

/** Previous name retained to avoid breaking existing Law 15 callers. */
export const forbiddenThrowInSecondTouch = forbiddenRestartSecondTouch

export function throwInTakerTarget(event: OutOfPlayEvent, setup: MatchSetup): Point2 {
  return {
    xM: clamp(event.spot.xM, .35, setup.pitch.lengthM - .35),
    // The footballer's centre stays close enough to the painted line
    // for a simplified .3m stance footprint to overlap the touchline.
    yM: event.side === 'top' ? .25 : setup.pitch.widthM - .25,
  }
}

/**
 * Law 15: the opposition cannot stand within two metres of the actual
 * touchline restart location. No teleport or penalty is manufactured:
 * autonomous defenders use regular locomotion to clear the area.
 */
export const THROW_IN_OPPONENT_CLEARANCE_M = 2
export const THROW_IN_FACING_TOLERANCE_RAD = .48
export function throwInFacingAngle(event: OutOfPlayEvent): number {
  return event.side === 'top' ? Math.PI / 2 : -Math.PI / 2
}
export function throwInTakerFacingField(
  player: PlayerMatchState, event: OutOfPlayEvent,
): boolean {
  return Math.abs(wrapRadians(
    player.orientationRad - throwInFacingAngle(event))) <=
    THROW_IN_FACING_TOLERANCE_RAD
}
export function throwInOpponentsClear(
  state: MatchState, event: OutOfPlayEvent,
): boolean {
  return state.players.every(p => p.clubId === event.awardedTeamId ||
    Math.hypot(p.position.xM - event.spot.xM,
      p.position.yM - event.spot.yM) >= THROW_IN_OPPONENT_CLEARANCE_M - 1e-8)
}

export function throwInDefenderRetreat(
  position: Point2, event: OutOfPlayEvent,
  setup: MatchSetup,
): Point2 {
  const dx = position.xM - event.spot.xM
  const dy = position.yM - event.spot.yM
  const distance = Math.hypot(dx,dy)
  if(distance >= THROW_IN_OPPONENT_CLEARANCE_M+.7)return position
  const inward=event.side==='top'?1:-1
  const ux=distance>.02?dx/distance:0
  const uy=distance>.02?dy/distance:inward
  return {
    xM:clamp(event.spot.xM+ux*2.9,0,setup.pitch.lengthM),
    yM:clamp(event.spot.yM+uy*2.9,0,setup.pitch.widthM),
  }
}

/** Three stable receiving lanes: a forward outlet, safe backward outlet,
 * and central third-man option. Real halftime directions come from state
 * teams, not static fixture club order.
 */
export function throwInReceiverTargets(
  event: OutOfPlayEvent, setup: MatchSetup,
  attackingDirection: 1|-1 =
    setup.clubs[0].id===event.awardedTeamId?1:-1,
): readonly [Point2,Point2,Point2] {
  const inward=event.side==='top'?1:-1
  const x=event.spot.xM,y=event.spot.yM
  const target=(forward:number,depth:number):Point2=>({
    xM:clamp(x+attackingDirection*forward,2.5,setup.pitch.lengthM-2.5),
    yM:clamp(y+inward*depth,2.5,setup.pitch.widthM-2.5),
  })
  return [target(8,7.2),target(-5.5,9),target(2.8,14.5)]
}

/** Inspect where the SAME real flight integrator would bring a correctly
 * aimed overhead throw toward each footballer. Receiver and opponent
 * locations are tactical forecasts; no contact or possession is granted.
 */
export interface ThrowInOption {
  readonly playerId:string
  readonly target:Point2
  readonly power:number
  readonly score:number
  readonly arrivalGapM:number
  readonly opponentGapM:number
}
export function assessThrowInOptions(
  state:MatchState,setup:MatchSetup,
  event:OutOfPlayEvent,
  receivers:readonly PlayerMatchState[],
  targets:readonly Point2[],
):readonly ThrowInOption[]{
  const team=state.teams.find(t=>t.clubId===event.awardedTeamId)
  if(!team)return []
  const taker=setup.players.find(p=>p.id===event.takerId)
  if(!taker)return []
  const choices:ThrowInOption[]=[]
  for(let i=0;i<receivers.length;i++){
    const player=receivers[i]
    const designated=targets[i]
    if(!designated || Math.hypot(player.position.xM-designated.xM,
        player.position.yM-designated.yM)>2.5)continue
    const distance=Math.hypot(player.position.xM-event.spot.xM,
      player.position.yM-event.spot.yM)
    if(distance<2.5||distance>27.5)continue
    const definition=setup.players.find(p=>p.id===player.playerId)
    if(!definition)continue
    const power=clamp(.55+distance*.0105,.55,.82)
    let flight:BallMatchState={
      ...state.ball,
      position:{...event.spot},heightM:THROW_IN_LAUNCH_HEIGHT_M,
      velocity:throwInFlightVelocity(event.spot,player.position,
        power,taker.abilities.physical.strength),
      controllerId:null,controlOffset:null,outsidePitch:false,
    }
    let landing={...player.position}
    let seconds=1.2
    for(let step=1;step<=48;step++){
      flight=advanceBallPhysics(flight,setup.pitch)
      if(flight.outsidePitch)break
      if(flight.heightM<=.53 && flight.velocity.zMps<=0){
        landing={...flight.position};seconds=step*.05
        break
      }
    }
    const arrivalGap=Math.hypot(player.position.xM-landing.xM,
      player.position.yM-landing.yM)
    let opponentGap=100
    for(const defender of state.players){
      if(defender.clubId===event.awardedTeamId)continue
      const projected={
        xM:defender.position.xM+defender.velocity.xMps*
          Math.min(.35,seconds*.25),
        yM:defender.position.yM+defender.velocity.yMps*
          Math.min(.35,seconds*.25),
      }
      const gap=Math.hypot(projected.xM-landing.xM,
        projected.yM-landing.yM)
      opponentGap=Math.min(opponentGap,gap)
    }
    const forward=(player.position.xM-event.spot.xM)*
      team.attackingDirection
    const firstTouch=definition.abilities.technical.firstTouch
    const opponentPressure=Math.max(0,4.5-opponentGap)*2.6
    const receptionRisk=arrivalGap*2.1
    const score=opponentGap*.52+forward*.24+
      firstTouch*.055-receptionRisk-opponentPressure-
      distance*.11
    choices.push({playerId:player.playerId,target:{...player.position},
      power,score,arrivalGapM:arrivalGap,opponentGapM:opponentGap})
  }
  return choices.sort((a,b)=>b.score-a.score ||
    a.playerId.localeCompare(b.playerId))
}

/** Real throw-ins require movement before release. Coordinates describe
 * RUNS, never teleported receptions. Defenders can track an option while
 * staying legally at least 2m from the touchline throwing point.
 */
export function stageThrowIn(
  state: MatchState, setup: MatchSetup,
): MatchState {
  const event=state.restart
  if(event?.kind!=='throwIn'||!event.awardedTeamId||!event.takerId)
    return state
  const aiIndex=state.teams.findIndex(t=>t.clubId===event.awardedTeamId)
  if(aiIndex<0||!state.ai.enabledTeams[aiIndex])return state
  const team=state.teams[aiIndex]
  const taker=state.players.find(p=>p.playerId===event.takerId)
  if(!taker)throw new Error('Missing throw-in taker')
  const takerTarget=throwInTakerTarget(event,setup)
  const available=state.players.filter(p=>
    p.clubId===event.awardedTeamId&&p.playerId!==event.takerId&&
    p.formationSlot!=='GK')
    .sort((a,b)=>{
      const point=(p:PlayerMatchState)=>
        state.ai.formationPositions[p.playerId]??p.position
      return Math.hypot(point(a).xM-event.spot.xM,
        point(a).yM-event.spot.yM)-
        Math.hypot(point(b).xM-event.spot.xM,
          point(b).yM-event.spot.yM)||
        a.playerId.localeCompare(b.playerId)
    })
  const receivers=available.slice(0,3)
  const targets=throwInReceiverTargets(event,setup,team.attackingDirection)
  const assignments=new Map<string,Point2>([
    [event.takerId,takerTarget],
    ...receivers.map((p,i)=>
      [p.playerId,targets[i]] as [string,Point2]),
  ])
  // Opponents that are already near a nominated outlet maintain a
  // credible marker. Others retain their natural pre-restart positions.
  const defenders=state.players.filter(p=>
    p.clubId!==event.awardedTeamId&&p.formationSlot!=='GK')
  const assignedMarkers=new Set<string>()
  for(let i=0;i<Math.min(2,receivers.length);i++){
    const target=targets[i]
    const mark=defenders.filter(p=>!assignedMarkers.has(p.playerId) &&
      Math.hypot(p.position.xM-target.xM,
        p.position.yM-target.yM)<7)
      .sort((a,b)=>Math.hypot(a.position.xM-target.xM,
          a.position.yM-target.yM)-
        Math.hypot(b.position.xM-target.xM,
          b.position.yM-target.yM)||
        a.playerId.localeCompare(b.playerId))[0]
    if(!mark)continue
    assignedMarkers.add(mark.playerId)
    assignments.set(mark.playerId,throwInDefenderRetreat({
      xM:clamp(target.xM-team.attackingDirection*1.6,
        .3,setup.pitch.lengthM-.3),
      yM:target.yM,
    },event,setup))
  }
  const players=state.players.map(p=>{
    const side=state.teams.findIndex(t=>t.clubId===p.clubId)
    if(side<0||!state.ai.enabledTeams[side])return p
    const nominated=assignments.get(p.playerId)??p.position
    // THR-F2: at the line, the foot-placement target is already reached
    // WELL within the legal stance envelope. Continuing to steer toward
    // its exact mathematical centre can undo the next tick's inward turn,
    // leaving the taker trapped between opposite headings indefinitely.
    // Brake at the *real current position* first, then let the existing
    // physically rate-limited facing code rotate the standing player.
    const stanceLegal=event.side==='top'
      ? p.position.yM<=.47
      : p.position.yM>=setup.pitch.widthM-.47
    const nearLine=p.playerId===event.takerId && stanceLegal &&
      Math.hypot(p.position.xM-takerTarget.xM,
        p.position.yM-takerTarget.yM)<.60 &&
      Math.hypot(p.velocity.xMps,p.velocity.yMps)<1.05
    const target=nearLine?p.position:
      p.clubId===event.awardedTeamId?nominated:
      throwInDefenderRetreat(nominated,event,setup)
    const same=!nearLine && p.intention.kind==='moveToPoint' &&
      Math.hypot(p.intention.target.xM-target.xM,
        p.intention.target.yM-target.yM)<.2
    return {...p,engagesBall:false,intention:same?p.intention:{
      kind:'moveToPoint' as const,
      sinceTick:state.clock.tick,target:{...target},
    }}
  })
  let staged:MatchState={...state,players,
    ai:{...state.ai,decisionSnapshot:[]}}
  const takerReady=Math.hypot(taker.position.xM-takerTarget.xM,
    taker.position.yM-takerTarget.yM)<.65 &&
    Math.hypot(taker.velocity.xMps,taker.velocity.yMps)<.7 &&
    throwInTakerFacingField(taker,event)
  const pending=staged.pendingCommands.some(c=>
    c.type==='attemptThrowIn' &&
    c.commandId.startsWith('ai-pass-throwin-'+event.tick+'-'))
  const actedThisTick=staged.appliedCommands.some(c=>
    c.type==='attemptThrowIn'&&c.appliedTick===state.clock.tick)
  if(!takerReady||state.clock.tick-event.tick<14||
      pending||actedThisTick||
      !throwInOpponentsClear(staged,event))return staged
  const choices=assessThrowInOptions(staged,setup,event,receivers,targets)
  // THR-F2: predefined runs are PREFERRED, not a prerequisite to play.
  // If nobody reached those precise coordinates, use any REAL teammate
  // who is physically within the 2.5–27.5m legal engine throw corridor.
  // The same pressure/landing simulation ranks those options; no one
  // receives a fictitious pass or teleports into a destination.
  const liveChoices=choices.length?choices:assessThrowInOptions(
    staged,setup,event,available,available.map(p=>p.position))
  if(!liveChoices.length)return staged
  const selected=liveChoices[0]
  const commandId='ai-pass-throwin-'+event.tick+'-'+state.clock.tick
  const receipt=scheduleMatchCommand(staged,{
    commandId,type:'attemptThrowIn',
    teamId:event.awardedTeamId,playerId:event.takerId,
    target:{...selected.target},power:selected.power,
  },setup.pitch)
  if(!receipt.receipt.accepted)
    throw new Error('Could not stage physical throw-in: '+
      receipt.receipt.reason)
  staged={...receipt.state,ai:{
    ...receipt.state.ai,lastPassTick:state.clock.tick,
    passIntent:{commandId,teamId:event.awardedTeamId,
      passerId:event.takerId,receiverId:selected.playerId,
      requestedTick:state.clock.tick,target:{...selected.target}},
  }}
  return staged
}

/** During a stoppage the footballers still walk/run to the throw-in and
 * receiving points using ordinary acceleration and braking, while the ball
 * remains out until a real command launches it from the touchline.
 */
export function advanceThrowInStoppage(
  state: MatchState, setup: MatchSetup,
  resolveContact: (state: MatchState, setup: MatchSetup) => MatchState,
): MatchState {
  const staged = stageThrowIn(state, setup)
  const moved = advancePlayerLocomotion(
    staged, setup.players, setup.pitch)
  const event=moved.restart
  // A taker who has reached the painted line must face INWARD before
  // throwing. Rotate only after slowing down; cap every turn by the same
  // individual agility/energy turning limit as regular player locomotion.
  // The positional 2D engine cannot animate both feet and hand joints.
  const facing=event?.kind==='throwIn'&&event.takerId
    ? {...moved,players:moved.players.map(p=>{
        if(p.playerId!==event.takerId)return p
        const target=throwInTakerTarget(event,setup)
        // Crucial: only rotate after the player's physical centre has
        // actually entered the LAW-15 stance band. Turning inward while
        // still inside the pitch cancels normal locomotion's outward
        // turn on every tick; with facing-based acceleration this can
        // leave a taker motionless ~0.4m short indefinitely.
        const legalStance=event.side==='top'
          ?p.position.yM<=.47
          :p.position.yM>=setup.pitch.widthM-.47
        if(!legalStance||
            Math.hypot(p.position.xM-target.xM,
              p.position.yM-target.yM)>.72 ||
            Math.hypot(p.velocity.xMps,p.velocity.yMps)>.7)return p
        const definition=setup.players.find(d=>d.id===p.playerId)
        if(!definition)throw new Error('Thrower missing player definition')
        const maxTurn=deriveMotionLimits(definition,p.energy)
          .turningRadps*.05
        const delta=clamp(wrapRadians(
          throwInFacingAngle(event)-p.orientationRad),
          -maxTurn,maxTurn)
        return {...p,orientationRad:wrapRadians(
          p.orientationRad+delta)}
      })} : moved
  const contacted = resolveContact(facing, setup)
  const outcome=contacted.contactEvents.find(c =>
    c.tick===contacted.clock.tick&&c.kind==='throwIn')
  if(!outcome||outcome.outcome!=='thrownIn'){
    // A failed contact is NOT a successful restart. Retire the
    // speculative receiver and let staging issue a fresh, distinct
    // command once both teams are physically in legal positions.
    if(outcome && contacted.ai.passIntent?.commandId===outcome.commandId)
      return {...contacted,ai:{...contacted.ai,passIntent:null}}
    return contacted
  }
  return { ...contacted, restart: null }
}
