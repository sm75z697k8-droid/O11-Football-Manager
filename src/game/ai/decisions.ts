import type { MatchSetup } from '../model/match'
import type { PlayerDefinition } from '../model/player'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, AgentDecision } from '../match/state'
import {
  AI_PASS_MIN_INTERVAL_TICKS, evaluateOnBallChoice,
} from './possession'

/**
 * Phase 5 — an initial deterministic football decision layer.
 * Calibrations are estimates, not machine-learned football behavior.
 * No wall-clock, random outcome generator or predetermined match event.
 */
export const AI_DECISION_PERIOD_TICKS = 12

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const distance = (a: Point2, b: Point2) => Math.hypot(a.xM - b.xM, a.yM - b.yM)
const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const clampTarget = (point: Point2, setup: MatchSetup): Point2 => ({
  xM: clamp(point.xM, 0, setup.pitch.lengthM),
  yM: clamp(point.yM, 0, setup.pitch.widthM),
})

function rankToBall(
  players: readonly PlayerMatchState[], state: MatchState,
  definitions: ReadonlyMap<string, PlayerDefinition>,
): PlayerMatchState[] {
  const kickoff = state.kickoff
  const takerRestricted = kickoff?.phase === 'inPlay' &&
    state.ball.lastTouchPlayerId === kickoff.kickerId
  return [...players]
    .filter(p => p.formationSlot !== 'GK' &&
      (!takerRestricted || p.playerId !== kickoff.kickerId))
    .sort((a, b) => {
    // The designated receiver is first to approach an opening pass.
    if (takerRestricted) {
      if (a.playerId === kickoff.receiverId) return -1
      if (b.playerId === kickoff.receiverId) return 1
    }
    const pa = definitions.get(a.playerId)
    const pb = definitions.get(b.playerId)
    const score = (p: PlayerMatchState, d: PlayerDefinition | undefined) =>
      distance(p.position, state.ball.position) -
      (d?.abilities.mental.anticipation ?? 50) * 0.022 -
      (d?.abilities.physical.acceleration ?? 50) * 0.01
    return score(a, pa) - score(b, pb) || lex(a.playerId, b.playerId)
  })
}

/**
 * Computes a compact, replaceable decision snapshot (max 22 entries), not
 * an ever-growing action log. Physical locomotion remains authoritative.
 */
export function planTeamDecisions(
  state: MatchState, setup: MatchSetup,
): readonly AgentDecision[] {
  const defs = new Map(setup.players.map(p => [p.id, p]))
  const decisions: AgentDecision[] = []
  const tick = state.clock.tick
  for (const [teamIndex, team] of state.teams.entries()) {
    if (!state.ai.enabledTeams[teamIndex]) continue
    const players = state.players.filter(p => p.clubId === team.clubId)
    const ownersTeam = state.ball.controllerId !== null &&
      players.some(p => p.playerId === state.ball.controllerId)
    const owner = ownersTeam
      ? players.find(p => p.playerId === state.ball.controllerId)
      : undefined
    const isDefending = state.ball.controllerId !== null && !ownersTeam
    const rank = rankToBall(players, state, defs)
    const ballAvailable = !state.ball.outsidePitch &&
      state.ball.heightM <= 2.5
    const defendingThird = (state.ball.position.xM -
      (team.attackingDirection === 1 ? 0 : setup.pitch.lengthM)) *
      team.attackingDirection < setup.pitch.lengthM * 0.43
    const pressCount = isDefending
      ? (team.pressingIntensity === 'high' ? 2 :
        team.pressingIntensity === 'standard' ? 1 :
        defendingThird ? 1 : 0)
      : owner ? 0 : team.pressingIntensity === 'high' ? 2 : 1
    const pursuers = new Set(ballAvailable ?
      rank.slice(0, pressCount).map(p => p.playerId) : [])

    for (const player of players) {
      const kickoff = setup.teams[teamIndex].starters.find(a =>
        a.playerId === player.playerId)
      if (!kickoff) throw new Error('Missing team assignment in agent planner')
      const initial = state.ai.formationPositions[player.playerId]
      if (!initial) throw new Error('Missing initial formation point')
      const baseShift = clamp(
        (state.ball.position.xM - setup.pitch.lengthM / 2) * 0.14, -7, 7,
      )
      const formationTarget = clampTarget({
        xM: initial.xM + baseShift,
        yM: initial.yM + clamp(
          (state.ball.position.yM - setup.pitch.widthM / 2) * 0.075, -3, 3,
        ),
      }, setup)
      let action: AgentDecision['action'] = 'shape'
      let target = formationTarget
      let engage = false
      if (player.playerId === owner?.playerId) {
        // Evaluate physical carrying routes and realistic pass lanes
        // against the SAME positions used by the match engine.
        const passReady =
          tick - state.ai.lastPassTick >= AI_PASS_MIN_INTERVAL_TICKS
        const choice = evaluateOnBallChoice(state, setup, passReady)
        action = 'carry'
        engage = true
        // Wait in place briefly for an imminent attempted kick; do not
        // sprint to the goal while the pass is already selected.
        target = choice?.kind === 'carry' ? choice.target : { ...player.position }
      } else if (pursuers.has(player.playerId)) {
        action = isDefending ? 'press' : 'pursue'
        engage = true
        target = clampTarget({
          xM: state.ball.position.xM -
            team.attackingDirection * (isDefending ? 0.45 : 0),
          yM: state.ball.position.yM,
        }, setup)
      } else if (ownersTeam && player.formationSlot !== 'GK') {
        action = 'support'
        const advance = team.attackingDirection * (
          player.duty === 'attack' ? 6 : player.duty === 'support' ? 3 : 0)
        // Move with the possession phase rather than remaining at the
        // frozen kickoff coordinates. The formation anchor still matters.
        const joinPlay = clamp((owner?.position.xM ?? formationTarget.xM) -
          formationTarget.xM, -20, 20) * .21
        target = clampTarget({
          xM: formationTarget.xM + advance + joinPlay,
          yM: formationTarget.yM,
        }, setup)
      }
      decisions.push({
        playerId: player.playerId, clubId: player.clubId,
        tick, action, target, engage,
      })
    }
  }
  return decisions
}

/** An attempted physical pass is authorized only when the utility planner
 * selects it. No target is automatically awarded successful possession.
 */
export function choosePossessionRelease(
  state: MatchState, setup: MatchSetup,
): { teamId: string; playerId: string; target: Point2; power: number; lift: number } | null {
  const owner = state.players.find(p => p.playerId === state.ball.controllerId)
  if (!owner || state.ball.outsidePitch || state.ball.heightM > .45 ||
      state.clock.tick - state.ai.lastPassTick < AI_PASS_MIN_INTERVAL_TICKS) return null
  const teamIndex = state.teams.findIndex(t => t.clubId === owner.clubId)
  if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return null
  const choice = evaluateOnBallChoice(state, setup)
  return choice?.kind === 'pass' ? {
    teamId: owner.clubId, playerId: owner.playerId,
    target: choice.target, power: choice.power, lift: choice.lift,
  } : null
}
