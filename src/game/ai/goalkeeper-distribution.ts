import type { MatchState } from '../match/state'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import { activeGoalkeeperCatch, GOALKEEPER_HOLD_MIN_TICKS } from '../physics/goalkeeper-handling'
import { passMeetingPoint } from './pass-viability'
import { segmentProximity } from './possession'

/**
 * Goalkeepers who genuinely catch a shot make a deliberate, bounded decision
 * to distribute from their hands. This is an initial safe outlet planner,
 * not full sweeper-keeper or tactical distribution intelligence.
 */
export interface GoalkeeperThrowChoice {
  readonly kind: 'throw'
  readonly teamId: string
  readonly playerId: string
  readonly receiverId: string
  readonly target: Point2
  readonly power: number
}
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

export function chooseGoalkeeperThrow(
  state: MatchState, setup: MatchSetup,
): GoalkeeperThrowChoice | null {
  const catchEvent = activeGoalkeeperCatch(state)
  if (!catchEvent) return null
  const keeper = state.players.find(p => p.playerId === catchEvent.playerId)
  if (!keeper) return null
  const teamIndex = state.teams.findIndex(t => t.clubId === keeper.clubId)
  if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return null
  const opponents = state.players.filter(p => p.clubId !== keeper.clubId)
  const nearestDanger = opponents.reduce((d, p) =>
    Math.min(d, distance(p.position, keeper.position)), 100)
  // Give the keeper time to secure the catch and survey the pitch.
  // Distribute sooner under pressure but always after the minimum hold.
  const holdTicks = nearestDanger < 9 ? GOALKEEPER_HOLD_MIN_TICKS + 5 :
    GOALKEEPER_HOLD_MIN_TICKS + 18
  if (state.clock.tick - catchEvent.tick < holdTicks) return null

  const candidates = state.players.filter(p =>
    p.clubId === keeper.clubId && p.playerId !== keeper.playerId &&
    p.formationSlot !== 'GK')
    .map(p => {
      const d = distance(keeper.position, p.position)
      if (d < 3 || d > 40) return null
      const aim = passMeetingPoint(p, setup)
      const nearestMarker = opponents.reduce((min, opponent) =>
        Math.min(min, distance(opponent.position, aim)), 100)
      const laneRisk = opponents.reduce((risk, opponent) => {
        const gap = segmentProximity(opponent.position, state.ball.position, aim)
        return risk + (gap.fraction > .08 && gap.fraction < .94
          ? Math.max(0, 3.2 - gap.distanceM) : 0)
      }, 0)
      const score = Math.min(nearestMarker, 10) * 2 -
        laneRisk * 3 - Math.max(0, d - 19) * .5 -
        Math.abs(d - 16) * .18
      return {p, d, aim, score}
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.score - a.score ||
      (a.p.playerId < b.p.playerId ? -1 : 1))
  const receiver = candidates[0]
  if (!receiver) return null
  return {
    kind:'throw', teamId:keeper.clubId, playerId:keeper.playerId,
    receiverId:receiver.p.playerId, target:receiver.aim,
    power:clamp((receiver.d - 4) / 26, .05, 1),
  }
}
