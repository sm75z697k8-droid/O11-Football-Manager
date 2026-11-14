import type { MatchState } from '../match/state'
import type { MatchSetup } from '../model/match'
import { formatMatchTime } from '../match/periods'
import { OUT_OF_PLAY_VERSION,throwInTakerTarget,throwInFacingAngle,
  throwInReceiverTargets,assessThrowInOptions } from '../match/restarts'
import { wrapRadians } from '../physics/locomotion'

/** An explicitly user-requested copyable reproduction report.
 * No network request, browser identifiers, account data or device location.
 * Expensive full-history aggregates run only after the Copy button is tapped.
 */
export const MATCH_DIAGNOSTICS_VERSION = 'o11-debug-report-v1'

/** Evaluated ONLY on the explicit Copy Debug Report action.
 * Unlike the engineVersion, this exposes the real current throw-in rules
 * and the exact readiness constraint when an AI restart isn't progressing.
 * No match state, positions or seed are modified by this diagnostic.
 */
function throwInStagingDetails(state:MatchState,setup?:MatchSetup){
  const event=state.restart
  if(event?.kind!=='throwIn'||!event.takerId||
      !event.awardedTeamId||!setup)return null
  const taker=state.players.find(p=>p.playerId===event.takerId)
  const team=state.teams.find(t=>t.clubId===event.awardedTeamId)
  if(!taker||!team)return null
  const target=throwInTakerTarget(event,setup)
  const gap=Math.hypot(taker.position.xM-target.xM,
    taker.position.yM-target.yM)
  const speed=Math.hypot(taker.velocity.xMps,taker.velocity.yMps)
  const facingError=wrapRadians(
    taker.orientationRad-throwInFacingAngle(event))
  const legalY=event.side==='top'
    ?taker.position.yM<=.47
    :taker.position.yM>=setup.pitch.widthM-.47
  const opponentGaps=state.players.filter(p=>p.clubId!==event.awardedTeamId)
    .map(p=>({playerId:p.playerId,
      distanceM:Math.hypot(p.position.xM-event.spot.xM,
        p.position.yM-event.spot.yM)}))
    .sort((a,b)=>a.distanceM-b.distanceM)
  const clear=opponentGaps.every(p=>p.distanceM>=2-1e-8)
  const available=state.players.filter(p=>p.clubId===event.awardedTeamId &&
    p.playerId!==event.takerId &&p.formationSlot!=='GK')
    .sort((a,b)=>{
      const anchor=(p:typeof a)=>
        state.ai.formationPositions[p.playerId]??p.position
      return Math.hypot(anchor(a).xM-event.spot.xM,
        anchor(a).yM-event.spot.yM)-
        Math.hypot(anchor(b).xM-event.spot.xM,
          anchor(b).yM-event.spot.yM)||
        a.playerId.localeCompare(b.playerId)
    })
  const preferred=available.slice(0,3)
  const points=throwInReceiverTargets(event,setup,team.attackingDirection)
  const primary=assessThrowInOptions(state,setup,event,preferred,points)
  const live=primary.length?primary:assessThrowInOptions(
    state,setup,event,available,available.map(p=>p.position))
  const commandPending=state.pendingCommands.some(c=>
    c.type==='attemptThrowIn')
  const blockedBy:string[]=[]
  if(!legalY||gap>=.65)blockedBy.push('taker_not_at_legal_touchline_stance')
  if(speed>=.7)blockedBy.push('taker_not_stationary')
  if(Math.abs(facingError)>.48)blockedBy.push('taker_not_facing_field')
  if(!clear)blockedBy.push('opponent_within_two_metres')
  if(!live.length)blockedBy.push('no_physically_available_receiver')
  if(commandPending)blockedBy.push('command_already_pending')
  if(state.clock.tick-event.tick<14)blockedBy.push('minimum_setup_ticks')
  return {
    elapsedTicks:state.clock.tick-event.tick,
    elapsedSeconds:Number(((state.clock.tick-event.tick)*.05).toFixed(2)),
    takerId:taker.playerId,
    takerPosition:taker.position,
    takerIntention:taker.intention,
    takerGapM:Number(gap.toFixed(3)),
    takerSpeedMps:Number(speed.toFixed(3)),
    takerFacingErrorRad:Number(facingError.toFixed(3)),
    legalTouchlineStance:legalY,
    nearestOpponents:opponentGaps.slice(0,3).map(p=>({
      ...p,distanceM:Number(p.distanceM.toFixed(3))})),
    receiverTargets:preferred.map((p,i)=>({
      playerId:p.playerId,
      distanceFromTargetM:Number(Math.hypot(
        p.position.xM-points[i].xM,
        p.position.yM-points[i].yM).toFixed(3)),
    })),
    physicallyAvailableReceivers:live.map(c=>c.playerId),
    blockedBy:blockedBy.length?blockedBy:['ready_for_throw'],
  }
}

export function copyableMatchDiagnostics(
  state: MatchState, setup?:MatchSetup,
): string {
  const lastKick = [...state.contactEvents].reverse().find(e =>
    e.outcome === 'kicked' || e.outcome === 'thrown' ||
    e.outcome === 'thrownIn' || e.outcome === 'goalKicked' ||
    e.outcome === 'cornerKicked')
  const player = state.players.find(p => p.playerId === state.ball.controllerId)
  const ball = state.ball
  return JSON.stringify({
    report: MATCH_DIAGNOSTICS_VERSION,
    engineVersion: state.engineVersion,
    throwInLogicVersion: OUT_OF_PLAY_VERSION,
    seed: state.seed.toString(16).toUpperCase().padStart(8, '0'),
    time: formatMatchTime(state),
    period: state.period,
    periodTiming: state.periodTiming,
    periodKickoff: state.periodKickoff,
    tick: state.clock.tick,
    terminal: state.period === 'fullTime' ? 'full-time' :
      state.period === 'halfTime' ? 'half-time' :
      state.periodKickoff ? 'second-half-' + state.periodKickoff.phase :
      state.postGoalKickoff
      ? 'post-goal-' + state.postGoalKickoff.phase :
      state.offsideRestart ? 'offside-indirect-free-kick' :
      state.foulRestart ? state.foulRestart.kind==='penalty'
        ? 'penalty-kick' : 'direct-free-kick' :
      state.restart?.kind === 'throwIn' ? 'throw-in-staging' :
        state.restart?.kind === 'goalKick' ? 'goal-kick-staging' :
        state.restart?.kind === 'corner' ? 'corner-staging' :
        ball.outsidePitch ? 'out-of-play' : 'playing',
    restart: state.restart,
    throwInStaging: throwInStagingDetails(state,setup),
    offsideRestart: state.offsideRestart,
    offsidePhase: state.offsidePhase,
    lastOffside: state.offsideEvents.at(-1) ?? null,
    offsides: state.offsideEvents.length,
    indirectFreeKick: state.indirectFreeKick,
    foulRestart: state.foulRestart,
    fouls: state.foulEvents.length,
    penalties: state.foulEvents.filter(f=>f.kind==='penalty').length,
    lastFoul: state.foulEvents.at(-1)??null,
    postGoalKickoff: state.postGoalKickoff,
    lastGoal: state.goalEvents.at(-1) ?? null,
    scoreboard: state.teams.map(t => ({
      clubId: t.clubId, goals: t.score,
    })),
    completedPostGoalKickoffs: state.contactEvents.filter(e =>
      e.outcome === 'kicked' &&
      e.commandId.startsWith('ai-pass-postgoal-')).length,
    outOfPlayCounts: {
      total: state.outOfPlayEvents.length,
      throwIns: state.outOfPlayEvents.filter(e => e.kind === 'throwIn').length,
      completedThrowIns: state.contactEvents.filter(
        e => e.outcome === 'thrownIn').length,
      goalKicks: state.outOfPlayEvents.filter(
        e => e.kind === 'goalKick').length,
      completedGoalKicks: state.contactEvents.filter(
        e => e.outcome === 'goalKicked').length,
      corners: state.outOfPlayEvents.filter(
        e => e.kind === 'corner').length,
      completedCorners: state.contactEvents.filter(
        e => e.outcome === 'cornerKicked').length,
    },
    aiTeams: state.ai.enabledTeams,
    commandsUsed: state.nextCommandSequence - 1,
    pendingCommands: state.pendingCommands.length,
    lastCommand: state.appliedCommands.at(-1) ?
      {
        id: state.appliedCommands.at(-1)!.commandId,
        tick: state.appliedCommands.at(-1)!.appliedTick,
      } : null,
    ball: {
      xM: Number(ball.position.xM.toFixed(3)),
      yM: Number(ball.position.yM.toFixed(3)),
      heightM: Number(ball.heightM.toFixed(3)),
      vx: Number(ball.velocity.xMps.toFixed(3)),
      vy: Number(ball.velocity.yMps.toFixed(3)),
      controller: player?.playerId ?? null,
      controllerTeam: player?.clubId ?? null,
      outsidePitch: ball.outsidePitch,
    },
    contactCounts: {
      attempted: state.contactEvents.length,
      automatic: state.automaticContactEvents.length,
    },
    lastPhysicalRelease: lastKick ?
      { tick: lastKick.tick, commandId: lastKick.commandId,
        playerId: lastKick.playerId, outcome: lastKick.outcome } : null,
    latestAutomaticContacts: state.automaticContactEvents.slice(-8).map(e =>
      ({ tick:e.tick, playerId:e.playerId, outcome:e.outcome })),
    lastAiDecisionTick: state.ai.lastDecisionTick,
    goals: state.goalEvents.length,
  }, null, 2)
}
