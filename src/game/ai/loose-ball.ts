import type { MatchSetup } from '../model/match'
import type { MatchState, PlayerMatchState } from '../match/state'
import { deriveMotionLimits } from '../physics/locomotion'
import {
  estimateInterception, pursuitTarget, separationM,
} from './coordination'

/**
 * Loose-ball race deliberately ignores last-touch ownership. A missed pass,
 * deflection or failed first touch must be contested by both teams.
 *
 * These are estimates of reaching the ball, not awarded interceptions.
 */
export const LOOSE_BALL_AI_VERSION = 'coordinated-recovery-handoff-v2'
const RECOVERY_SAMPLE_LIMIT_S = 3.2

export function estimatedRecoverySeconds(
  player: PlayerMatchState, state: MatchState, setup: MatchSetup,
): number {
  const definition = setup.players.find(p => p.id === player.playerId)
  if (!definition) throw new Error('Missing player definition in recovery estimate')
  const reachable = estimateInterception(player, definition, state.ball, setup.pitch)
  if (reachable) return reachable.etaSeconds
  const maxSpeed = deriveMotionLimits(definition, player.energy).maxSpeedMps
  return RECOVERY_SAMPLE_LIMIT_S +
    separationM(player.position, state.ball.position) / Math.max(maxSpeed, 1)
}

export interface LooseBallRace {
  readonly favoredTeamId: string
  readonly pursuerIds: Readonly<Record<string, string>>
  readonly arrivalSeconds: Readonly<Record<string, number>>
}

/** For either XI, nominate a real recovery candidate even when it did not
 * touch the ball last. Keep goalkeepers out of generic outfield recovery.
 */
export function assessLooseBallRace(
  state: MatchState, setup: MatchSetup,
): LooseBallRace | null {
  if (state.ball.outsidePitch || state.ball.controllerId !== null ||
      state.kickoff?.phase === 'awaitingKick') return null
  const pursuerIds: Record<string, string> = {}
  const arrivalSeconds: Record<string, number> = {}
  for (const team of state.teams) {
    const ranked = state.players
      .filter(p => p.clubId === team.clubId && p.formationSlot !== 'GK')
      .map(player => ({
        player,
        time: estimatedRecoverySeconds(player, state, setup),
      }))
      .sort((a, b) => a.time - b.time ||
        (a.player.playerId < b.player.playerId ? -1 : a.player.playerId > b.player.playerId ? 1 : 0))
    const nearest = ranked[0]
    if (!nearest) throw new Error('Missing outfield footballer for recovery')
    // The genuine opening pass has a designated receiving midfielder.
    // Let that footballer anticipate their own pass while the ball is free;
    // physical movement/contact can still fail or be intercepted.
    const kickoff = state.kickoff?.phase === 'inPlay' &&
      state.ball.lastTouchPlayerId === state.kickoff.kickerId &&
      state.kickoff.teamId === team.clubId
        ? ranked.find(c => c.player.playerId === state.kickoff?.receiverId)
        : undefined
    // Honor the opening receiver if still competitive, but do not force a
    // hopeless chase after a badly misplaced opening kick.
    const nominated = kickoff && kickoff.time <= nearest.time + .55
      ? kickoff : nearest
    pursuerIds[team.clubId] = nominated.player.playerId
    arrivalSeconds[team.clubId] = nominated.time
  }
  // A small tie preference for the last passer avoids jitter without
  // treating 'last touch' as guaranteed possession.
  const lastTouchClub = state.players.find(p =>
    p.playerId === state.ball.lastTouchPlayerId)?.clubId
  const [home, away] = state.teams
  const homeTime = arrivalSeconds[home.clubId]
  const awayTime = arrivalSeconds[away.clubId]
  const tie = Math.abs(homeTime - awayTime) <= .22
  const kickoffPass = state.kickoff?.phase === 'inPlay' &&
    state.ball.lastTouchPlayerId === state.kickoff.kickerId
  // Keep the opening passing team's support response until somebody
  // actually touches the ball, not for subsequent mispasses/open play.
  const favoredTeamId = kickoffPass
    ? state.kickoff!.teamId
    : tie && lastTouchClub
      ? lastTouchClub
      : homeTime <= awayTime ? home.clubId : away.clubId
  return { favoredTeamId, pursuerIds, arrivalSeconds }
}

/** Re-target the *already designated* two loose-ball challengers every
 * physics tick. The tactical planner still chooses their identities, so
 * this cannot turn every player into a homing dot.
 */
export function followMovingLooseBall(
  state: MatchState, setup: MatchSetup,
): MatchState {
  if (state.ball.controllerId !== null || state.ball.outsidePitch ||
      state.kickoff?.phase === 'awaitingKick' ||
      state.ai.lastDecisionTick < 0) return state

  const chasers = state.ai.decisionSnapshot
    .filter(d => d.engage &&
      (d.action === 'receive' || d.action === 'pursue' || d.action === 'press'))
  if (!chasers.length) return state
  const updates = new Map<string, ReturnType<typeof pursuitTarget>>()
  for (const decision of chasers) {
    const player = state.players.find(p => p.playerId === decision.playerId)
    const definition = setup.players.find(p => p.id === decision.playerId)
    if (!player || !definition) continue
    // An explicit successful-pass receiver retains its dedicated path.
    if (state.ai.passIntent?.receiverId === player.playerId) continue
    updates.set(player.playerId,
      pursuitTarget(player, definition, state.ball, setup.pitch))
  }
  if (!updates.size) return state
  const players = state.players.map(p => {
    const target = updates.get(p.playerId)
    if (!target) return p
    const prev = p.intention
    const unchanged = prev.kind === 'moveToPoint' &&
      separationM(prev.target, target) < .2
    return {
      ...p, engagesBall: true,
      intention: unchanged ? prev : {
        kind: 'moveToPoint' as const, sinceTick: state.clock.tick, target,
      },
    }
  })
  const decisionSnapshot = state.ai.decisionSnapshot.map(d => {
    const target = updates.get(d.playerId)
    return target ? { ...d, target } : d
  })
  return { ...state, players, ai: { ...state.ai, decisionSnapshot } }
}
