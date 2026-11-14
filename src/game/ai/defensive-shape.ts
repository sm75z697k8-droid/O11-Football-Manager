import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, separationM } from './coordination'
import { planIndividualDefensiveResponses } from './defensive-individual'
import { maintainWidePassFlightScreen, planWidePressingTrap } from './pressing-traps'
import { planCentralPressing } from './central-pressing'

/**
 * Phase 6.5 — Team-first defensive responsibilities.
 *
 * A role has a *home defensive zone* in its own attacking coordinates.
 * Only nearby threats inside a dangerous attacking corridor can override
 * recovery. The physics engine, not this planner, decides physical contact.
 */
// Version identifier below reflects the active physical pressure policy.
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n))

type AssignedAction = 'press' | 'jockey' | 'cover' | 'mark' | 'screen' | 'recover' | 'shape'
export interface DefensiveAssignment {
  readonly action: AssignedAction
  readonly target: Point2
  readonly engage: boolean
}
const centreBack = (p: PlayerMatchState): boolean =>
  p.formationSlot === 'RCB' || p.formationSlot === 'LCB'
const defender = (p: PlayerMatchState): boolean =>
  centreBack(p) || p.formationSlot === 'LB' || p.formationSlot === 'RB'
const midfielder = (p: PlayerMatchState): boolean =>
  p.formationSlot === 'DM' || p.formationSlot === 'RCM' ||
  p.formationSlot === 'LCM'
const forwardProgress = (xM: number, length: number, direction: 1 | -1) =>
  direction === 1 ? xM : length - xM
const worldX = (progress: number, length: number, direction: 1 | -1) =>
  direction === 1 ? progress : length - progress

/** The zonal recovery point is always goal-side of the opposition attack
 * for central midfield and defence, without all players joining the chase.
 */
export function defensiveRecoveryTarget(
  player: PlayerMatchState, original: Point2, ball: Point2,
  team: TeamMatchState, setup: MatchSetup,
): Point2 {
  const { lengthM, widthM } = setup.pitch
  const direction = team.attackingDirection
  const ownAnchor = forwardProgress(original.xM, lengthM, direction)
  const ballProgress = forwardProgress(ball.xM, lengthM, direction)
  const slot = player.formationSlot
  if (slot === 'GK') {
    return boundedTarget({
      xM: worldX(clamp(ownAnchor, 2.5, 8), lengthM, direction),
      yM: widthM / 2 + clamp((ball.yM - widthM / 2) * .10, -2, 2),
    }, setup.pitch)
  }
  // Midfielders RECOVER behind the ball, rather than remaining upfield to
  // track an irrelevant opposing fullback. Attackers stay higher for outlets.
  const gap = centreBack(player) ? 18 :
    defender(player) ? 15 :
    slot === 'DM' ? 11 :
    slot === 'RCM' || slot === 'LCM' ? 7 :
    slot === 'RW' || slot === 'LW' ? 2 : -4
  const anchorShift = clamp((ballProgress - lengthM / 2) * .35, -24, 12)
  const shapeProgress = ownAnchor + anchorShift
  const lineLimit = ballProgress - gap
  const progress = clamp(Math.min(shapeProgress, lineLimit), 4, lengthM - 4)
  const yCentre = widthM / 2
  const baseShift = clamp((ball.yM - yCentre) * .24, -9, 9)
  let yM = original.yM + baseShift
  // Keep the team's established right/left identities. Wide attackers tuck
  // into a defensive midfield line but don't swap their flanks.
  const flank = slot === 'RCM' || slot === 'RW' || slot === 'RB' ? 1 :
    slot === 'LCM' || slot === 'LW' || slot === 'LB' ? -1 : 0
  if (flank) {
    const side = flank * direction
    const minChannel = midfielder(player) ? 2.5 : 5
    yM = side > 0 ? Math.max(yCentre + minChannel, yM) :
      Math.min(yCentre - minChannel, yM)
  }
  if (slot === 'ST') {
    yM = yCentre + clamp((ball.yM - yCentre) * .16, -4, 4)
  }
  return boundedTarget({
    xM: worldX(progress, lengthM, direction), yM,
  }, setup.pitch)
}

/** Only a threat near the ball and closer to OUR goal than the current
 * danger line should pull a player out of their defensive recovery slot.
 * Opponent centre-backs behind their own attack will never qualify.
 */
export function isRelevantDefensiveThreat(
  opponent: PlayerMatchState, ball: Point2,
  team: TeamMatchState, setup: MatchSetup,
): boolean {
  if (opponent.formationSlot === 'GK') return false
  const length = setup.pitch.lengthM
  const ballProgress = forwardProgress(ball.xM, length, team.attackingDirection)
  const opponentProgress = forwardProgress(
    opponent.position.xM, length, team.attackingDirection)
  return opponentProgress <= Math.min(length * .80, ballProgress + 13) &&
    opponentProgress >= Math.max(0, ballProgress - 38)
}

function keeperPenalty(player: PlayerMatchState) {
  return defender(player) ? 2.5 :
    player.formationSlot === 'DM' ? .6 : 0
}

/**
 * Phase 6.9O — intent-based, team-limited defensive pressure.
 *
 * Distances are deliberately estimated tactical calibrations, not a model
 * trained on professional tracking data. Real movement and tackles remain
 * in the 50ms physics engine.
 */
export const DEFENSIVE_PLANNER_VERSION = 'central-cover-shadows-prs-s12-v1'
export const PRESSING_SWITCH_MARGIN_M = 3.5

interface PressContext {
  readonly carrier: PlayerMatchState | undefined
  readonly goalDistanceM: number
  readonly trappedWide: boolean
  readonly drivingAtGoal: boolean
  readonly settledReception: boolean
}

function pressContext(
  state: MatchState, ballPoint: Point2, team: TeamMatchState,
  setup: MatchSetup,
): PressContext {
  const carrier = state.players.find(p =>
    p.playerId === state.ball.controllerId && p.clubId !== team.clubId)
  const goalDistanceM = forwardProgress(
    ballPoint.xM, setup.pitch.lengthM, team.attackingDirection)
  const trappedWide = ballPoint.yM < 9 ||
    ballPoint.yM > setup.pitch.widthM - 9
  // Genuine goalward momentum is more threatening than a sideways jog.
  const drivingAtGoal = !!carrier &&
    carrier.velocity.xMps * team.attackingDirection < -1.1
  // The latest relevant first touch matters, not the entire ever-growing
  // event history. Reverse scan with no .filter/.map allocations on iPhone.
  let lastControlled = -1000
  if (carrier) {
    for (let i = state.contactEvents.length - 1; i >= 0; i--) {
      const e = state.contactEvents[i]
      if (e.playerId === carrier.playerId && e.outcome === 'controlled') {
        lastControlled = e.tick
        break
      }
    }
    for (let i = state.automaticContactEvents.length - 1; i >= 0; i--) {
      const e = state.automaticContactEvents[i]
      if (e.playerId === carrier.playerId &&
          (e.outcome === 'intercepted' || e.outcome === 'wonChallenge')) {
        lastControlled = Math.max(lastControlled, e.tick)
        break
      }
    }
  }
  const settledReception = !!carrier &&
    state.clock.tick - lastControlled <= 8 &&
    state.clock.tick - lastControlled >= 0
  return { carrier, goalDistanceM, trappedWide,
    drivingAtGoal, settledReception }
}

/** Does not award a tackle, press success or possession. It answers only
 * whether this player should abandon shape to close down the ball NOW.
 * Low pressing can allow nonthreatening possession with no active presser.
 */
export function shouldPressCarrier(
  player: PlayerMatchState, ballPoint: Point2,
  team: TeamMatchState, context: PressContext,
): boolean {
  if (player.formationSlot === 'GK') return false
  const distance = separationM(player.position, ballPoint)
  const emergency = context.goalDistanceM <= 26
  const immediateContact = distance <= 3.5
  // Pressing is a deliberate event, not a permanent radius around the ball.
  // Nearby but unthreatening ownership is CONTAINED from shape, not chased.
  const triggered = team.pressingIntensity === 'low'
    ? (emergency && distance <= 10) || distance <= 3.2
    : team.pressingIntensity === 'standard'
      ? immediateContact ||
        (emergency && distance <= 11) ||
        (context.goalDistanceM <= 38 && distance <= 6.5) ||
        (context.trappedWide && distance <= 8.5) ||
        (context.drivingAtGoal && distance <= 8.5) ||
        (context.settledReception && distance <= 14)
      : distance <= (emergency ? 22 : 18) +
        ((context.trappedWide || context.drivingAtGoal ||
          context.settledReception) ? 3 : 0)
  if (!triggered) return false
  // A centre-back must protect the last line unless a real near-foot
  // challenge or an immediate goal threat justifies breaking that line.
  if (centreBack(player) && !emergency && !immediateContact) return false
  return true
}

function primaryPressers(
  state: MatchState, setup: MatchSetup,
  teammates: readonly PlayerMatchState[], ball: Point2,
  team: TeamMatchState, preferredPlayerId?: string,
): PlayerMatchState[] {
  const context = pressContext(state, ball, team, setup)
  const previousPressIds = new Set(state.ai.decisionSnapshot
    .filter(d => d.clubId === team.clubId && d.action === 'press')
    .map(d => d.playerId))
  // Keep free-ball racing separate from controlled-carrier pressing.
  // A real nominated recovery player is still allowed to chase a loose ball.
  const candidates = teammates.filter(p =>
    p.formationSlot !== 'GK' &&
    (context.carrier
      ? shouldPressCarrier(p, ball, team, context)
      : separationM(p.position, ball) <=
        (team.pressingIntensity === 'high' ? 30 : 23) ||
        p.playerId === preferredPlayerId))
    .map(p => {
      const distance = separationM(p.position, ball)
      const anchor = state.ai.formationPositions[p.playerId]
      const recover = anchor
        ? defensiveRecoveryTarget(p, anchor, ball, team, setup)
        : p.position
      const leavingShape = separationM(p.position, recover)
      const score = distance + keeperPenalty(p) * 2.3 +
        leavingShape * .10 -
        // Modest continuity: one slightly closer colleague should not
        // instantly reverse 6v6 pressing responsibility every 0.6 seconds.
        (context.carrier && previousPressIds.has(p.playerId) &&
          distance <= 9 ? PRESSING_SWITCH_MARGIN_M : 0) -
        (!context.carrier && p.playerId === preferredPlayerId ? 20 : 0)
      return {player:p,score,distance}
    })
    .sort((a, b) => a.score - b.score ||
      (a.player.playerId < b.player.playerId ? -1 :
        a.player.playerId > b.player.playerId ? 1 : 0))
  const primary = candidates[0]
  if (!primary) return []
  if (team.pressingIntensity !== 'high') return [primary.player]
  const second = candidates.find(p => p.player.playerId !== primary.player.playerId &&
    p.distance <= 14 &&
    // Two straight-line chasers are reserved for a *real* trap, not
    // the default response to a midfielder holding the ball.
    (context.trappedWide || context.goalDistanceM <= 24 ||
      context.settledReception))
  return second ? [primary.player, second.player] : [primary.player]
}

/** A close defender may deliberately jockey rather than lunging through a
 * ball carrier. Skill, relative angle and momentum affect that choice.
 * The separate body-contact engine still decides if committed contact is foul.
 */
export function shouldCommitTackle(
  setup:MatchSetup,
  tackler:PlayerMatchState,carrier:PlayerMatchState,
  team:TeamMatchState,
):boolean{
  const gap=separationM(tackler.position,carrier.position)
  if(gap>2.5)return true // close the gap before attempting any foot contact
  const def=setup.players.find(p=>p.id===tackler.playerId)
  if(!def)return false
  const vx=tackler.position.xM-carrier.position.xM
  const vy=tackler.position.yM-carrier.position.yM
  const behind=(vx*Math.cos(carrier.orientationRad)+
    vy*Math.sin(carrier.orientationRad))/Math.max(gap,.01)<-.45
  const relative=Math.hypot(
    tackler.velocity.xMps-carrier.velocity.xMps,
    tackler.velocity.yMps-carrier.velocity.yMps)
  const skill=def.abilities
  const judgement=.38*skill.technical.tackling+
    .27*skill.mental.decisions+
    .22*skill.mental.anticipation+
    .13*skill.mental.composure
  const pressure=skill.mental.aggression*.13+
    (team.pressingIntensity==='high'?3:0)
  const emergency=team.attackingDirection===1
    ? carrier.position.xM<22 : carrier.position.xM>setup.pitch.lengthM-22
  const threshold=(behind?61:43)+Math.max(0,relative-3)*2-
    (emergency?7:0)
  return judgement+pressure>=threshold
}

/** Goal-side approach while outside immediate challenge range. Only
 * physically closing inside 3.5m switches to the ball's exact position.
 * The contact solver—not this intention—decides actual tackle outcomes.
 */
export function pressingApproachTarget(
  player: PlayerMatchState, ball: Point2,
  team: TeamMatchState, setup: MatchSetup,
): Point2 {
  if (separationM(player.position, ball) <= 3.5)
    return boundedTarget(ball, setup.pitch)
  return boundedTarget({
    xM: ball.xM - team.attackingDirection * 1.9,
    yM: ball.yM + clamp(
      (player.position.yM - ball.yM) * .16, -1.3, 1.3),
  }, setup.pitch)
}

function defensiveCover(
  teammates: readonly PlayerMatchState[], ball: Point2,
  team: TeamMatchState, setup: MatchSetup, excluded: ReadonlySet<string>,
): PlayerMatchState | null {
  const goalSideX = ball.xM - team.attackingDirection * 7
  const reference = boundedTarget({
    xM: goalSideX, yM: ball.yM,
  }, setup.pitch)
  const choices = teammates.filter(p =>
    p.formationSlot !== 'GK' && !excluded.has(p.playerId))
  choices.sort((a, b) => {
    const score = (p: PlayerMatchState) =>
      separationM(p.position, reference) +
      (p.formationSlot === 'DM' ? -2.5 :
        midfielder(p) ? 0 : centreBack(p) ? 3 : 8)
    return score(a) - score(b) ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  })
  return choices[0] ?? null
}

/** One consistent world snapshot assigns pressing, covering, marking, and
 * recovery roles. Exactly one assignment per team player, no side effects.
 */
export function planDefensiveResponsibilities(
  state: MatchState, setup: MatchSetup, team: TeamMatchState,
  ballPoint: Point2, preferredRecoveryId?: string,
): ReadonlyMap<string, DefensiveAssignment> {
  const teammates = state.players.filter(p => p.clubId === team.clubId)
  const opponents = state.players.filter(p => p.clubId !== team.clubId)
  const pressing = primaryPressers(state, setup, teammates, ballPoint, team, preferredRecoveryId)
  const pressingIds = new Set(pressing.map(p => p.playerId))
  const flightScreen = maintainWidePassFlightScreen(state,team)
  const cover = defensiveCover(
    teammates.filter(p=>p.playerId!==flightScreen?.screenerId),
    ballPoint, team, setup, pressingIds)
  const assignments = new Map<string, DefensiveAssignment>()
  // The shared physical snapshot still chooses at most the original
  // pressers and one cover player. Everyone else reasons individually
  // about off-ball runners, lanes, role, and their own abilities.
  const blocks=new Map<string,Point2>(teammates.map(p=>{
    const anchor=state.ai.formationPositions[p.playerId]
    if(!anchor)throw new Error('Missing defensive formation anchor')
    return [p.playerId,defensiveRecoveryTarget(
      p,anchor,ballPoint,team,setup)]
  }))
  // Wide traps add one lane screener without stealing cover or a direct presser.
  // No invented interception: only a movement target for existing physics.
  const trap=planWidePressingTrap(
    state,setup,team,ballPoint,pressing,cover?.playerId??null,blocks)
  const central=trap ? null : planCentralPressing(
    state,setup,team,ballPoint,pressing,cover,blocks)
  const reservedScreenerId=trap?.screenerId??central?.screenerId??
    flightScreen?.screenerId
  const eligible=teammates.filter(p=>
    p.formationSlot!=='GK' && !pressingIds.has(p.playerId) &&
    p.playerId!==cover?.playerId && p.playerId!==reservedScreenerId)
  const threats=opponents.filter(p=>
    isRelevantDefensiveThreat(p,ballPoint,team,setup))
  const individual=planIndividualDefensiveResponses(
    state,setup,team,ballPoint,eligible,threats,blocks)
  for (const player of teammates) {
    const block=blocks.get(player.playerId)!

    let action: AssignedAction = 'recover'
    let target = block
    let engage = false
    if (player.formationSlot === 'GK') action = 'shape'
    else if (pressingIds.has(player.playerId)) {
      const carrier=state.players.find(p=>
        p.playerId===state.ball.controllerId &&
        p.clubId!==player.clubId)
      const committed=!carrier ||
        shouldCommitTackle(setup,player,carrier,team)
      action=committed?'press':'jockey'
      engage=committed
      // Current controller is the physical threat. The 50ms movement engine
      // approaches the actual ball, not a fake successful tackle.
      target = committed
        ? trap?.presserId===player.playerId
          ? trap.approachTarget
          : central?.presserId===player.playerId
            ? central.approachTarget
            : pressingApproachTarget(player, ballPoint, team, setup)
        : central?.presserId===player.playerId
          ? central.jockeyTarget
          : boundedTarget({
            xM:ballPoint.xM-team.attackingDirection*1.3,
            yM:ballPoint.yM+(player.position.yM<ballPoint.yM?-1.1:1.1),
          },setup.pitch)
    } else if (cover?.playerId === player.playerId) {
      action = 'cover'
      // Goal-side containment should SCREEN the carrier, not drag a
      // second non-engaging defender 25 metres out of the formation.
      // The prescribed tactical displacement is bounded from this
      // footballer's own defensive recovery point.
      const ideal = boundedTarget({
        xM: ballPoint.xM - team.attackingDirection * 7,
        yM: ballPoint.yM +
          (player.position.yM <= ballPoint.yM ? -3.5 : 3.5),
      }, setup.pitch)
      const gap = separationM(block, ideal)
      const maximumShift = team.pressingIntensity === 'low' ? 7 :
        team.pressingIntensity === 'standard' ? 10 : 13
      const ratio = gap > maximumShift ? maximumShift / gap : 1
      target = boundedTarget({
        xM: block.xM + (ideal.xM - block.xM) * ratio,
        yM: block.yM + (ideal.yM - block.yM) * ratio,
      }, setup.pitch)
    } else if (trap?.screenerId===player.playerId) {
      // The defender blocks a REAL carrier-to-outlet lane; the ball must
      // still physically reach this player to be intercepted.
      action='screen'
      target=trap.screenTarget
      // The opposition still owns the ball; merely block the lane.
      engage=false
    } else if (central?.screenerId===player.playerId &&
        central.screenTarget) {
      // Different central forward lane; passive until a genuine ball flight.
      action='screen'
      target=central.screenTarget
      engage=false
    } else if (flightScreen?.screenerId===player.playerId) {
      action='screen'
      target=flightScreen.screenTarget
      // A REAL free kick in flight may now be intercepted by swept contact.
      engage=true
    } else {
      const response=individual.get(player.playerId)
      if(response){
        action=response.action
        target=response.target
        // Defensive recognition moves the player into space, NOT into
        // automatic ownership or a guaranteed tackle animation.
        engage=false
      }
    }
    assignments.set(player.playerId, {
      action, target, engage,
    })
  }
  return assignments
}
