import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, AgentDecision } from '../match/state'
import {
  AI_PASS_MIN_INTERVAL_TICKS, evaluateOnBallChoice,
} from './possession'
import {
  boundedTarget, coverTarget, estimateInterception, markTarget,
  predictBallAt, pursuitTarget, rankBallChasers, separationM, supportTarget,
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

  for (const [teamIndex, team] of state.teams.entries()) {
    if (!state.ai.enabledTeams[teamIndex]) continue
    const teammates = state.players.filter(p => p.clubId === team.clubId)
    const opponents = state.players.filter(p => p.clubId !== team.clubId)
    const owner = teammates.find(p => p.playerId === ball.controllerId)
    const ownsLooseBall = ball.controllerId === null &&
      belongsTo(team.clubId, ball.lastTouchPlayerId, state.players)
    const inAttack = owner !== undefined || ownsLooseBall
    const isDefending = !inAttack && (ball.controllerId !== null ||
      (ball.lastTouchPlayerId !== null && !ownsLooseBall))
    const rank = rankBallChasers(
      teammates, definitions, ball, setup.pitch, restrictedTaker)
    const defendingThird = (ball.position.xM -
      (team.attackingDirection === 1 ? 0 : setup.pitch.lengthM)) *
      team.attackingDirection < setup.pitch.lengthM * .43

    // A press consists of a first challenger, optionally a second high-press
    // challenger; one distinct cover player always protects behind.
    const pressCount = !ballUsable || owner ? 0 : isDefending
      ? team.pressingIntensity === 'high' ? 2 :
        team.pressingIntensity === 'standard' || defendingThird ? 1 : 0
      : team.pressingIntensity === 'high' ? 2 : 1
    const pressing = rank.slice(0, pressCount)
    const pressingIds = new Set(pressing.map(p => p.playerId))
    const cover = isDefending && ballUsable
      ? rank.find(p => !pressingIds.has(p.playerId)) : undefined

    // For a ball rolling towards our team, plan support around the *estimated
    // reception*, not the position of the ball at this instant.
    const prospectiveReceiver = ownsLooseBall ? rank[0] : undefined
    const meeting = prospectiveReceiver && definitions.get(prospectiveReceiver.playerId)
      ? estimateInterception(prospectiveReceiver,
        definitions.get(prospectiveReceiver.playerId)!, ball, setup.pitch)?.target
      : undefined
    const attackingReference = owner?.position ?? meeting ?? projectedBall
    const coveredMarkIds = new Set<string>()

    for (const player of teammates) {
      const original = state.ai.formationPositions[player.playerId]
      if (!original) throw new Error('Missing initial formation point')
      const shape = formationShape(original, ball.position, setup.pitch)
      let action: AgentDecision['action'] = 'shape'
      let target: Point2 = shape
      let engage = false

      if (player.playerId === owner?.playerId) {
        const canPass = state.clock.tick - state.ai.lastPassTick >=
          AI_PASS_MIN_INTERVAL_TICKS
        const choice = evaluateOnBallChoice(state, setup, canPass)
        action = 'carry'
        engage = true
        target = choice?.kind === 'carry'
          ? choice.target : { ...player.position }
      } else if (pressingIds.has(player.playerId)) {
        const def = definitions.get(player.playerId)
        if (!def) throw new Error('Missing pursuing footballer definition')
        action = ownsLooseBall ? 'receive' : isDefending ? 'press' : 'pursue'
        engage = true
        target = pursuitTarget(player, def, ball, setup.pitch)
      } else if (cover && cover.playerId === player.playerId) {
        action = 'cover'
        target = coverTarget(player, pressing[0] ?? player,
          projectedBall, team.attackingDirection, setup.pitch)
      } else if (inAttack && player.formationSlot !== 'GK') {
        action = 'support'
        target = supportTarget(player, original, attackingReference,
          team.attackingDirection, setup)
      } else if (isDefending && player.formationSlot !== 'GK') {
        // Mark the nearest available opponent in this player's sector;
        // each threat is assigned to at most one defender.
        const threats = opponents.filter(p => p.formationSlot !== 'GK' &&
          !coveredMarkIds.has(p.playerId) &&
          separationM(p.position, shape) <= 19)
          .sort((a, b) =>
            separationM(a.position, shape) - separationM(b.position, shape) ||
            (a.playerId < b.playerId ? -1 :
              a.playerId > b.playerId ? 1 : 0))
        const threat = threats[0]
        if (threat) {
          coveredMarkIds.add(threat.playerId)
          action = 'mark'
          target = markTarget(shape, threat, team.attackingDirection, setup.pitch)
        }
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
): { teamId: string; playerId: string; target: Point2; power: number; lift: number } | null {
  const owner = state.players.find(p => p.playerId === state.ball.controllerId)
  if (!owner || state.ball.outsidePitch || state.ball.heightM > .45 ||
      state.clock.tick - state.ai.lastPassTick < AI_PASS_MIN_INTERVAL_TICKS) return null
  const index = state.teams.findIndex(t => t.clubId === owner.clubId)
  if (index < 0 || !state.ai.enabledTeams[index]) return null
  const choice = evaluateOnBallChoice(state, setup)
  return choice?.kind === 'pass'
    ? {
      teamId: owner.clubId, playerId: owner.playerId,
      target: choice.target, power: choice.power, lift: choice.lift,
    } : null
}
