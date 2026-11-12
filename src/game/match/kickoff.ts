import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { Formation433Slot } from '../model/team'
import type { KickoffState, MatchState } from './state'
import type { AttemptKickRequest } from './commands'

/** Opening kick-off only. Other match restarts remain separate future work.
 * Law 8: all other players remain within their own halves, and opponents
 * are 9.15m or more from the stationary centre ball before the kick.
 */
export const OPENING_KICKOFF_COMMAND_ID = 'o11-opening-kickoff' as const
export const KICKOFF_CLEAR_MOVEMENT_M = 0.035
export const KICKOFF_OPPONENT_CLEARANCE_M = 9.3

function kickoffIndex(setup: MatchSetup): number {
  return setup.kickoff
    ? setup.clubs.findIndex(club => club.id === setup.kickoff?.teamId) : -1
}

/**
 * Reuses the same metric 4-3-3 assignments; only the opening formation is
 * rearranged. The general legacy physics fixture stays unchanged.
 */
export function openingKickoffPosition(
  setup: MatchSetup, teamIndex: number, slot: Formation433Slot,
  formationPosition: Point2,
): Point2 {
  const takingIndex = kickoffIndex(setup)
  if (takingIndex === -1) return formationPosition
  const centreX = setup.pitch.lengthM / 2
  const centreY = setup.pitch.widthM / 2
  const side = teamIndex === 0 ? -1 : 1
  const isTaking = teamIndex === takingIndex
  if (isTaking && slot === 'ST') {
    return { xM: centreX + side * 0.77, yM: centreY }
  }
  if (isTaking && (slot === 'RCM' || slot === 'LCM')) {
    // Two legal short outlets either side of the centre mark. The
    // selected option is based on player attributes, not hardcoded RCM.
    return {
      xM: centreX + side * 5.8,
      yM: centreY + (slot === 'RCM' ? 3.4 : -3.4),
    }
  }
  // All non-kickers stay in their own half, with the defending side
  // outside the required 9.15m centre-circle radius.
  const clearance = isTaking ? 1.8 : KICKOFF_OPPONENT_CLEARANCE_M
  return {
    xM: side < 0
      ? Math.min(formationPosition.xM, centreX - clearance)
      : Math.max(formationPosition.xM, centreX + clearance),
    yM: formationPosition.yM,
  }
}

export function openingKickoffState(setup: MatchSetup): KickoffState | null {
  const index = kickoffIndex(setup)
  if (index === -1) return null
  const starters = setup.teams[index].starters
  const kickerId = starters.find(p => p.slot === 'ST')?.playerId
  const candidateReceivers = starters
    .filter(p => p.slot === 'RCM' || p.slot === 'LCM')
    .map(assignment => {
      const definition = setup.players.find(p => p.id === assignment.playerId)
      if (!definition) throw new Error('Missing kick-off midfielder definition')
      const a = definition.abilities
      // Choice of recipient is an estimated football judgment; execution
      // still uses normal seeded contact/ball physics.
      const score = .48 * a.technical.firstTouch +
        .27 * a.technical.technique +
        .25 * a.mental.anticipation
      return { playerId: assignment.playerId, score }
    })
    .sort((a, b) => b.score - a.score ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
  const receiverId = candidateReceivers[0]?.playerId
  if (!kickerId || !receiverId) {
    throw new Error('Kick-off requires a striker and two central midfield options')
  }
  return {
    teamId: setup.teams[index].clubId,
    kickerId, receiverId,
    phase: 'awaitingKick',
    takenTick: null,
  }
}

export function openingKickoffPass(state: MatchState): AttemptKickRequest {
  const kick = state.kickoff
  if (!kick || kick.phase !== 'awaitingKick' || state.clock.tick !== 0) {
    throw new Error('Opening kick-off pass must be scheduled before the first tick')
  }
  const receiver = state.players.find(player => player.playerId === kick.receiverId)
  const kicker = state.players.find(player => player.playerId === kick.kickerId)
  if (!receiver || !kicker || kicker.clubId !== kick.teamId ||
      receiver.clubId !== kick.teamId) {
    throw new Error('Kick-off striker and receiver must belong to the taking team')
  }
  const centre = state.ball.position
  if (Math.hypot(kicker.position.xM - centre.xM, kicker.position.yM - centre.yM) > 1.0) {
    throw new Error('Kicker is not within physical foot reach of centre ball')
  }
  return {
    commandId: OPENING_KICKOFF_COMMAND_ID,
    type: 'attemptKick',
    teamId: kick.teamId,
    playerId: kick.kickerId,
    target: { ...receiver.position },
    power: 0.19,
    lift: 0,
  }
}

/** Advance only after the genuine kick has produced visible physical motion,
 * never from a synthetic ball teleport or an invented possession event.
 */
export function advanceOpeningKickoff(state: MatchState, setup: MatchSetup): MatchState {
  if (state.kickoff?.phase !== 'awaitingKick') return state
  const event = state.contactEvents.find(e =>
    e.commandId === OPENING_KICKOFF_COMMAND_ID &&
    e.outcome === 'kicked' && e.playerId === state.kickoff?.kickerId)
  if (!event) return state
  const centreX = setup.pitch.lengthM / 2
  const centreY = setup.pitch.widthM / 2
  if (Math.hypot(state.ball.position.xM - centreX,
    state.ball.position.yM - centreY) < KICKOFF_CLEAR_MOVEMENT_M) return state
  return {
    ...state,
    kickoff: {
      ...state.kickoff,
      phase: 'inPlay',
      takenTick: state.clock.tick,
    },
  }
}
