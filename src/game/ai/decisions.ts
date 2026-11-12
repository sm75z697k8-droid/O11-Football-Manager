import type { MatchSetup } from '../model/match'
import type { PlayerDefinition } from '../model/player'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState, AgentDecision } from '../match/state'

/**
 * Phase 5 — an initial deterministic football decision layer.
 * Calibrations are estimates, not machine-learned football behavior.
 * No wall-clock, random outcome generator or predetermined match event.
 */
export const AI_DECISION_PERIOD_TICKS = 12
export const AI_PASS_MIN_INTERVAL_TICKS = 36

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

function passingOption(
  owner: PlayerMatchState, colleagues: readonly PlayerMatchState[],
  opponents: readonly PlayerMatchState[],
  defs: ReadonlyMap<string, PlayerDefinition>, attack: number, setup: MatchSetup,
): { target: Point2; power: number; lift: number } | null {
  const ability = defs.get(owner.playerId)?.abilities
  if (!ability) return null
  let chosen: { player: PlayerMatchState; dist: number; score: number; pressure: number } | null = null
  for (const teammate of colleagues) {
    if (teammate.playerId === owner.playerId || teammate.formationSlot === 'GK') continue
    const dist = distance(owner.position, teammate.position)
    if (dist < 5 || dist > 35) continue
    const progress = (teammate.position.xM - owner.position.xM) * attack
    if (progress < -3) continue
    const close = opponents.reduce((min, defender) =>
      Math.min(min, distance(defender.position, teammate.position)), 1000)
    const open = Math.min(10, close)
    const suitability = defs.get(teammate.playerId)?.abilities.mental.offTheBall ?? 50
    const score = progress * 0.65 + open * 1.8 + suitability * 0.075 -
      Math.abs(dist - 17) * 0.38
    if (!chosen || score > chosen.score ||
        (score === chosen.score && lex(teammate.playerId, chosen.player.playerId) < 0)) {
      chosen = { player: teammate, dist, score, pressure: close }
    }
  }
  if (!chosen) return null
  const target = clampTarget({
    xM: chosen.player.position.xM + chosen.player.velocity.xMps * 0.25,
    yM: chosen.player.position.yM + chosen.player.velocity.yMps * 0.25,
  }, setup)
  // The lift and power control the existing physical kick, not the result.
  return {
    target,
    power: clamp(0.15 + chosen.dist / (35 + ability.technical.passing * 0.11), 0.22, 0.95),
    lift: chosen.pressure < 3.5 ? 0.22 : 0.04,
  }
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
        action = 'carry'
        engage = true
        const advance = team.attackingDirection * (7 + (
          defs.get(player.playerId)?.abilities.mental.decisions ?? 50
        ) / 40)
        target = clampTarget({
          xM: player.position.xM + advance,
          yM: player.position.yM +
            clamp((setup.pitch.widthM / 2 - player.position.yM) * 0.18, -2, 2),
        }, setup)
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
        target = clampTarget({
          xM: formationTarget.xM + advance,
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

/** Choose a kick only if the owner is pressed and there is a viable receiver.
 * A decision is an attempted physical kick: no guaranteed completed pass.
 */
export function choosePossessionRelease(
  state: MatchState, setup: MatchSetup,
): { teamId: string; playerId: string; target: Point2; power: number; lift: number } | null {
  const owner = state.players.find(p => p.playerId === state.ball.controllerId)
  if (!owner || state.ball.outsidePitch || state.ball.heightM > 0.45 ||
      state.clock.tick - state.ai.lastPassTick < AI_PASS_MIN_INTERVAL_TICKS) return null
  const teamIndex = state.teams.findIndex(t => t.clubId === owner.clubId)
  if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return null
  const others = state.players.filter(p => p.clubId !== owner.clubId)
  const nearest = Math.min(...others.map(p => distance(p.position, owner.position)))
  if (nearest > 8) return null
  const players = state.players.filter(p => p.clubId === owner.clubId)
  const definitions = new Map(setup.players.map(p => [p.id, p]))
  const result = passingOption(
    owner, players, others, definitions,
    state.teams[teamIndex].attackingDirection, setup,
  )
  return result ? { ...result, teamId: owner.clubId, playerId: owner.playerId } : null
}
