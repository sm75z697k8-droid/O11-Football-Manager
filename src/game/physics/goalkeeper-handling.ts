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

/**
 * Shared hand-throw flight model for the authoritative resolver and the
 * non-awarding preview. `angleErrorRad` is drawn only by the REAL contact
 * engine; preview always uses the nominal intended bearing.
 */
export function goalkeeperThrowVelocity(
  from: {readonly xM:number;readonly yM:number},
  to: {readonly xM:number;readonly yM:number},
  power: number, angleErrorRad = 0,
): {readonly xMps:number;readonly yMps:number;readonly zMps:number} {
  const heading = Math.atan2(to.yM - from.yM, to.xM - from.xM)
  const angle = heading + angleErrorRad
  const speed = 4.8 + power * 9.3
  return {
    xMps: Math.cos(angle) * speed,
    yMps: Math.sin(angle) * speed,
    zMps: .4 + power * 1.2,
  }
}
