import type { MatchState } from './state'
import { OPENING_KICKOFF_COMMAND_ID } from './kickoff'

/**
 * Laws 8, 10, 13, 15, 16 and 17: a whole-ball goalmouth crossing is not
 * automatically a goal. First determine the origin of the LAST successful
 * physical player touch, not the last command attempted, the last chosen
 * tactical pass or the scorer's ID alone.
 *
 * Contact history already exists in the authoritative match state. This
 * avoids allocating another per-tick log / mutable "direct shot" flag and
 * works after a ball bounces off the ground or the goal frame.
 */
export const GOAL_ELIGIBILITY_VERSION = 'physical-last-touch-lawful-goals-s171-v1'

export type PhysicalGoalTouchOrigin =
  | 'throwIn' | 'goalkeeperThrow' | 'goalKick' | 'cornerKick'
  | 'kickoff' | 'directFreeKick' | 'indirectFreeKick'
  | 'penalty' | 'ordinary' | 'automatic'

export interface PhysicalGoalTouch {
  readonly tick: number
  readonly playerId: string
  readonly origin: PhysicalGoalTouchOrigin
}

export type DisallowedDirectGoal = {
  readonly origin: PhysicalGoalTouchOrigin
  readonly awardedRestart: 'goalKick' | 'corner'
  readonly touch: PhysicalGoalTouch
}

const REAL_MANUAL_TOUCHES = new Set([
  'controlled', 'miscontrolled', 'kicked', 'thrown',
  'thrownIn', 'goalKicked', 'cornerKicked',
])

function manualOrigin(
  outcome: string, commandId: string,
): PhysicalGoalTouchOrigin {
  if (outcome === 'thrownIn') return 'throwIn'
  if (outcome === 'thrown') return 'goalkeeperThrow'
  if (outcome === 'goalKicked') return 'goalKick'
  if (outcome === 'cornerKicked') return 'cornerKick'
  if (outcome !== 'kicked') return 'ordinary'
  if (commandId.startsWith('ai-pass-offside-')) return 'indirectFreeKick'
  if (commandId.startsWith('ai-pass-foul-')) return 'directFreeKick'
  if (commandId.startsWith('ai-shot-penalty-')) return 'penalty'
  if (commandId === OPENING_KICKOFF_COMMAND_ID ||
      commandId.startsWith('ai-pass-postgoal-') ||
      commandId.startsWith('ai-pass-secondhalf-')) return 'kickoff'
  return 'ordinary'
}

/**
 * The automatic swept-contact resolver executes after manual contact.
 * A deflection, save, punched clearance or unsuccessful reception which
 * physically touched the ball makes a preceding direct throw/kick no
 * longer "direct". A held-off player-body challenge does NOT touch it.
 *
 * Only call this on a goalmouth crossing or checkpoint validation; scanning
 * retained history on every 50ms iPhone physics tick would be wasteful.
 */
export function latestPhysicalGoalTouch(
  state: MatchState, throughTick = state.clock.tick,
): PhysicalGoalTouch | null {
  let manual: PhysicalGoalTouch | null = null
  for (let i = state.contactEvents.length - 1; i >= 0; i--) {
    const e = state.contactEvents[i]
    if (e.tick > throughTick || !REAL_MANUAL_TOUCHES.has(e.outcome)) continue
    manual = {
      tick: e.tick, playerId: e.playerId,
      origin: manualOrigin(e.outcome, e.commandId),
    }
    break
  }
  for (let i = state.automaticContactEvents.length - 1; i >= 0; i--) {
    const e = state.automaticContactEvents[i]
    if (e.tick > throughTick || e.outcome === 'heldOff') continue
    // Manual controls take place before automatic arbitration within a
    // shared tick; only a later-tick manual touch beats an automatic one.
    if (manual && manual.tick > e.tick) break
    return { tick: e.tick, playerId: e.playerId, origin: 'automatic' }
  }
  return manual
}

/**
 * Return the correct legal alternative if this particular crossing cannot
 * score. The scoring team's ID is the team ATTACKING the crossed goal, not
 * necessarily the club responsible for the last touch (own goals).
 *
 * After a prohibited direct goal, existing whole-ball out-of-play handling
 * awards the appropriate goal kick or corner from the actual crossing; do
 * not create a score or an artificial ball movement here.
 */
export function disallowedDirectGoal(
  state: MatchState,
  scoringTeamId: string,
  atTick = state.clock.tick,
): DisallowedDirectGoal | null {
  const touch = latestPhysicalGoalTouch(state, atTick)
  if (!touch) return null
  // The authoritative ball must agree with the latest successful touch
  // during a live crossing; historical goal events are checked separately.
  if (atTick === state.clock.tick &&
      touch.playerId !== state.ball.lastTouchPlayerId) return null
  const player = state.players.find(p => p.playerId === touch.playerId)
  if (!player) return null
  const againstOpponents = player.clubId === scoringTeamId
  const origin = touch.origin
  const prohibited = origin === 'throwIn' ||
    origin === 'indirectFreeKick' ||
    (origin === 'goalkeeperThrow' && againstOpponents) ||
    (['goalKick', 'cornerKick', 'kickoff', 'directFreeKick']
      .includes(origin) && !againstOpponents)
  // Preserve the S1.6 indirect-kick guard even if a future contact source
  // is introduced before its authoritative log is expanded.
  if (!prohibited && atTick === state.clock.tick &&
      state.indirectFreeKick !== null &&
      touch.tick === state.indirectFreeKick.kickedTick &&
      touch.playerId === state.indirectFreeKick.takerId) {
    return {
      origin: 'indirectFreeKick',
      awardedRestart: againstOpponents ? 'goalKick' : 'corner',
      touch,
    }
  }
  return prohibited ? {
    origin,
    awardedRestart: againstOpponents ? 'goalKick' : 'corner',
    touch,
  } : null
}
