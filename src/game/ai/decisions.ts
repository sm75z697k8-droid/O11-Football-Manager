import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, AgentDecision } from '../match/state'
import { activePassIntent, intendedReceiverTarget } from './pass-coordination'
import { chooseDynamicSupport } from './support-space'
import { planDefensiveResponsibilities } from './defensive-shape'
import { planHeldGoalkeeperShape } from './goalkeeper-possession-shape'
import { planGoalkeeperSave } from './goal-directed'
import { assessLooseBallRace } from './loose-ball'
import {
  canReleaseControlledBall, evaluateOnBallChoice,
} from './possession'
import type { PossessionChoice } from './possession'
import {
  boundedTarget, estimateInterception,
  predictBallAt, pursuitTarget, rankBallChasers, supportTarget,
} from './coordination'

/** Phase 6.3: Team coordinated intentions; physics remains authoritative.
 * These are estimated role/geometry heuristics, not learned tactics.
 */
export const AI_DECISION_PERIOD_TICKS = 12
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function formationShape(
  original: Point2, ball: Point2, pitch: MatchSetup['pitch'],
): Point2 {
  const baseShift = clamp((ball.xM - pitch.lengthM / 2) * .14, -7, 7)
  return boundedTarget({
    xM: original.xM + baseShift,
    yM: original.yM + clamp(
      (ball.yM - pitch.widthM / 2) * .075, -3, 3),
  }, pitch)
}

function belongsTo(teamId: string, playerId: string | null,
  players: readonly PlayerMatchState[]): boolean {
  return playerId !== null && players.some(p =>
    p.playerId === playerId && p.clubId === teamId)
}

/** All 22 agents receive one intention in a bounded snapshot, based on one
 * consistent physical world state. It is not an event or animation script.
 */
export function planTeamDecisions(
  state: MatchState, setup: MatchSetup,
  evaluatedChoice?: PossessionChoice | null,
): readonly AgentDecision[] {
  const definitions = new Map(setup.players.map(p => [p.id, p]))
  const decisions: AgentDecision[] = []
  const ball = state.ball
  const ballUsable = !ball.outsidePitch && ball.heightM <= 2.5
  const projectedBall = ball.controllerId === null
    ? predictBallAt(ball, .42).position : ball.position
  const restrictedTaker = state.kickoff?.phase === 'inPlay' &&
    ball.lastTouchPlayerId === state.kickoff.kickerId
      ? state.kickoff.kickerId : null
  // Last touch is NOT possession. A misplaced pass is a genuine 50/50
  // recovery race, judged by future physical interception opportunities.
  const looseRace = ballUsable ? assessLooseBallRace(state, setup) : null

  for (const [teamIndex, team] of state.teams.entries()) {
    if (!state.ai.enabledTeams[teamIndex]) continue
    const teammates = state.players.filter(p => p.clubId === team.clubId)
    // A real keeper's HAND catch is a third tactical phase, neither
    // generic possession support nor an opponent pressing/chasing phase.
    // Both teams need one coherent shape while the keeper surveys outlets.
    // All 22 athletes still move through ordinary authoritative locomotion.
    const heldShape = planHeldGoalkeeperShape(state, setup, team.clubId)
    if (heldShape) {
      for (const player of teammates) {
        const assigned = heldShape.get(player.playerId)
        if (!assigned) throw new Error('Incomplete held-keeper team shape')
        decisions.push(assigned)
      }
      continue
    }
    const owner = teammates.find(p => p.playerId === ball.controllerId)
    const ownsLooseBall = looseRace
      ? looseRace.favoredTeamId === team.clubId
      : ball.controllerId === null &&
        belongsTo(team.clubId, ball.lastTouchPlayerId, state.players)
    const inAttack = owner !== undefined || ownsLooseBall
    const isDefending = !inAttack && (ball.controllerId !== null ||
      (ball.lastTouchPlayerId !== null && !ownsLooseBall) ||
      looseRace !== null)
    const rank = rankBallChasers(
      teammates, definitions, ball, setup.pitch, restrictedTaker)
    // Defensive pressure is assigned to the TEAM rather than choosing
    // isolated chasers. Attacking pursuit remains with the original physics.
    const defensivePlan = isDefending && ballUsable
      ? planDefensiveResponsibilities(state, setup, team, projectedBall,
        looseRace?.pursuerIds[team.clubId])
      : null
    const pressCount = !ballUsable || owner || isDefending ? 0 :
      team.pressingIntensity === 'high' ? 2 : 1
    // The passer commits to a particular teammate. Until contact or loss,
    // that receiver is given the first opportunity rather than leaving a
    // coordinated pass to a different generic ball-chasing footballer.
    const intent = activePassIntent(state)
    const committed = intent?.teamId === team.clubId
      ? teammates.find(p => p.playerId === intent.receiverId) : undefined
    const pursuit = looseRace?.pursuerIds[team.clubId]
      ? teammates.find(p => p.playerId === looseRace.pursuerIds[team.clubId])
      : undefined
    const pressing = committed ? [committed] :
      pursuit && !isDefending ? [pursuit] : rank.slice(0, pressCount)
    const pressingIds = new Set(pressing.map(p => p.playerId))

    // For a ball rolling towards our team, plan support around the *estimated
    // reception*, not the position of the ball at this instant.
    // Set the support shape around the same nominated recovery player,
    // not a separately ranked teammate with a different receiving run.
    const prospectiveReceiver = ownsLooseBall
      ? teammates.find(p => p.playerId === looseRace?.pursuerIds[team.clubId]) ?? rank[0]
      : undefined
    const meeting = prospectiveReceiver && definitions.get(prospectiveReceiver.playerId)
      ? estimateInterception(prospectiveReceiver,
        definitions.get(prospectiveReceiver.playerId)!, ball, setup.pitch)?.target
      : undefined
    const attackingReference = owner?.position ?? meeting ?? projectedBall
    const dynamicSupport = inAttack && ballUsable
      ? chooseDynamicSupport(state, setup, team.clubId, attackingReference,
        new Set([
          ...(owner ? [owner.playerId] : []),
          ...pressingIds,
        ]))
      : null

    for (const player of teammates) {
      const original = state.ai.formationPositions[player.playerId]
      if (!original) throw new Error('Missing initial formation point')
      const shape = formationShape(original, ball.position, setup.pitch)
      let action: AgentDecision['action'] = 'shape'
      let target: Point2 = shape
      let engage = false

      const keeperSave = player.formationSlot === 'GK' && isDefending
        ? planGoalkeeperSave(state, setup, player, team) : null
      if (keeperSave) {
        action = 'save'
        engage = keeperSave.engage
        target = keeperSave.target
      } else if (player.playerId === owner?.playerId) {
        const canPass = canReleaseControlledBall(state, setup)
        const choice = evaluatedChoice !== undefined
          ? evaluatedChoice : evaluateOnBallChoice(state, setup, canPass, true)
        action = choice?.kind === 'shoot' ? 'shoot' : 'carry'
        engage = ball.heightM < .5
        target = ball.heightM >= .5 ? { ...player.position } :
          choice?.kind === 'carry'
            ? choice.target : { ...player.position }
      } else if (looseRace && committed?.playerId === player.playerId) {
        // Preserve the actual receiver's physical run while a kicked pass
        // is in flight, even if an opponent has the better recovery chance.
        action = 'receive'
        engage = true
        target = intendedReceiverTarget(state, setup, intent!)
      } else if (defensivePlan) {
        const assigned = defensivePlan.get(player.playerId)
        if (!assigned) throw new Error('Defensive player missing team responsibility')
        action = assigned.action
        engage = assigned.engage
        target = assigned.target
      } else if (pressingIds.has(player.playerId)) {
        const def = definitions.get(player.playerId)
        if (!def) throw new Error('Missing pursuing footballer definition')
        action = committed?.playerId === player.playerId || ownsLooseBall
          ? 'receive' : 'pursue'
        engage = true
        target = committed?.playerId === player.playerId && intent
          ? intendedReceiverTarget(state, setup, intent)
          : pursuitTarget(player, def, ball, setup.pitch)
      } else if (inAttack && player.formationSlot !== 'GK') {
        action = 'support'
        target = dynamicSupport?.get(player.playerId)?.target ??
          supportTarget(player, original, attackingReference,
            team.attackingDirection, setup)
      }
      decisions.push({
        playerId: player.playerId, clubId: player.clubId,
        tick: state.clock.tick, action, target, engage,
      })
    }
  }
  return decisions
}

/** A contextual pass is an ordinary physical kick command, not an awarded
 * completed pass. Existing interception and seed-sensitive physics decide.
 */
export function choosePossessionRelease(
  state: MatchState, setup: MatchSetup,
  evaluatedChoice?: PossessionChoice | null,
): { kind: 'pass' | 'shoot'; teamId: string; playerId: string; receiverId?: string; target: Point2; power: number; lift: number } | null {
  const owner = state.players.find(p => p.playerId === state.ball.controllerId)
  if (!owner || state.ball.outsidePitch || state.ball.heightM > .45 ||
      !canReleaseControlledBall(state, setup)) return null
  const index = state.teams.findIndex(t => t.clubId === owner.clubId)
  if (index < 0 || !state.ai.enabledTeams[index]) return null
  const choice = evaluatedChoice !== undefined
    ? evaluatedChoice : evaluateOnBallChoice(state, setup, true, true)
  return choice?.kind === 'pass' || choice?.kind === 'shoot'
    ? {
      kind: choice.kind,
      teamId: owner.clubId, playerId: owner.playerId,
      ...(choice.kind === 'pass' ? { receiverId: choice.receiverId } : {}),
      target: choice.target, power: choice.power, lift: choice.lift,
    } : null
}
