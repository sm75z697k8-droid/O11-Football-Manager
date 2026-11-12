import type { MatchState, AutomaticContactEvent } from '../match/state'

/** An actual hand catch is distinct from ordinary ground-level foot control.
 * No new pseudo-possession engine or animation-only goalkeeper saves. */
export const GOALKEEPER_HAND_HEIGHT_M = 1.12
export const GOALKEEPER_HOLD_MIN_TICKS = 44

/** A hands-held ball is supported by its last real physical catch event.
 * The checkpoint validator independently verifies this provenance. */
export function activeGoalkeeperCatch(
  state: MatchState,
): AutomaticContactEvent | null {
  const id = state.ball.controllerId
  if (id === null ||
      Math.abs(state.ball.heightM - GOALKEEPER_HAND_HEIGHT_M) > 1e-8 ||
      !state.players.some(p => p.playerId === id && p.formationSlot === 'GK'))
    return null
  for (let i = state.automaticContactEvents.length - 1; i >= 0; i--) {
    const event = state.automaticContactEvents[i]
    if (event.outcome === 'caught' && event.playerId === id) return event
  }
  return null
}
