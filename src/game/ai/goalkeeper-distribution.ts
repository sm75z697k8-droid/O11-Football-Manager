import type { MatchState, PlayerMatchState } from '../match/state'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import { activeGoalkeeperCatch, GOALKEEPER_HOLD_MIN_TICKS } from '../physics/goalkeeper-handling'
import { passMeetingPoint } from './pass-viability'
import { segmentProximity } from './possession'
import {
  previewPhysicalGoalkeeperThrow,
} from './goalkeeper-throw-preview'
import type { GoalkeeperThrowPreview } from './goalkeeper-throw-preview'

/**
 * Phase 6.9L: decisions about a REAL caught ball, not synthetic passes.
 * Compare a small number of physically rehearsed hand-throws, receiver
 * reachability and prospective interception risk. All scores are untrained
 * simulation estimates, NEVER a promised completion probability.
 */
export const GOALKEEPER_DISTRIBUTION_VERSION = 'physics-rehearsed-hand-outlets-v1'
export interface GoalkeeperThrowChoice {
  readonly kind: 'throw'
  readonly teamId: string
  readonly playerId: string
  readonly receiverId: string
  readonly target: Point2
  readonly power: number
}

export interface GoalkeeperThrowAssessment extends GoalkeeperThrowChoice {
  readonly utility: number
  readonly forecast: GoalkeeperThrowPreview
  readonly nearestOpponentM: number
  readonly laneRisk: number
}

const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

function distanceFromPressure(
  target: Point2, opponents: readonly PlayerMatchState[],
): number {
  return opponents.reduce((min, opponent) =>
    Math.min(min, distance(opponent.position, target)), 100)
}

function obstruction(
  from: Point2, target: Point2, opponents: readonly PlayerMatchState[],
): number {
  return opponents.reduce((risk, opponent) => {
    const sample = segmentProximity(opponent.position, from, target)
    return risk + (sample.fraction > .08 && sample.fraction < .94
      ? Math.max(0, 3.5 - sample.distanceM) : 0)
  }, 0)
}

/**
 * Readable assessments for diagnostics/unit tests. These use a real
 * 50ms ball-flight and receiver-motion preview, with an independent
 * opponent-interception estimate. All throws remain ordinary commands.
 */
export function assessGoalkeeperThrowOptions(
  state: MatchState, setup: MatchSetup,
): readonly GoalkeeperThrowAssessment[] {
  const caught = activeGoalkeeperCatch(state)
  if (!caught || state.ball.outsidePitch) return []
  const keeper = state.players.find(p => p.playerId === caught.playerId)
  const keeperDefinition = setup.players.find(p => p.id === caught.playerId)
  if (!keeper || !keeperDefinition?.abilities.goalkeeping) return []
  const teamIndex = state.teams.findIndex(t => t.clubId === keeper.clubId)
  if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return []
  const opponents = state.players.filter(p => p.clubId !== keeper.clubId)
  const team = state.teams[teamIndex]
  const abilities = keeperDefinition.abilities
  const keeperSkills = abilities.goalkeeping
  if (!keeperSkills) return []
  const awareness = (
    .46 * abilities.mental.vision +
    .38 * abilities.mental.decisions +
    .16 * abilities.mental.composure) / 100
  const accuracy = (
    .60 * keeperSkills.throwingDistribution +
    .25 * abilities.technical.technique +
    .15 * abilities.mental.composure) / 100
  const angleSpread = .015 + (1 - accuracy) * .12

  const assessments: GoalkeeperThrowAssessment[] = []
  for (const receiver of state.players) {
    if (receiver.clubId !== keeper.clubId ||
        receiver.playerId === keeper.playerId ||
        receiver.formationSlot === 'GK') continue
    const target = passMeetingPoint(receiver, setup)
    const d = distance(state.ball.position, target)
    if (d < 5 || d > 39) continue
    const nearestOpponentM = distanceFromPressure(target, opponents)
    const laneRisk = obstruction(state.ball.position, target, opponents)
    const forward = (
      target.xM - keeper.position.xM) * team.attackingDirection
    // These are TWO launch speeds, not a promise to make either throw.
    // Slightly stronger throws may reach a moving teammate sooner, but
    // high relative velocity makes the first touch less reliable.
    const powers = [
      clamp((d - 4) / 26, .17, 1),
      clamp((d - 6) / 19, .25, 1),
    ]
    for (const [index, power] of powers.entries()) {
      if (index && Math.abs(power - powers[0]) < .035) continue
      const forecast = previewPhysicalGoalkeeperThrow(
        state.ball, receiver, target, power, setup, opponents)
      const opponentMargin = forecast.opponentEtaSeconds !== null &&
        forecast.receptionSeconds !== null
        ? forecast.opponentEtaSeconds - forecast.receptionSeconds
        : 1.4
      const recognition = .55 + awareness * .9
      const interceptionPenalty = Math.max(0, .7 - opponentMargin) *
        (6 + 7 * recognition)
      const uncontrolledPenalty = forecast.canControl ? 0 : 21
      const boundaryGap = Math.min(
        target.xM, setup.pitch.lengthM - target.xM,
        target.yM, setup.pitch.widthM - target.yM)
      const trajectoryUncertainty = d * Math.sin(angleSpread)
      // Higher Decisions/Vision recognizes screening/pressure; low
      // ability may mis-rank tempting risky outlets. Receiver controls,
      // if they happen, are still entirely decided by real ball contact.
      const utility =
        15 + (forecast.canControl ? 20 : 0) +
        .85 * Math.min(nearestOpponentM, 11) +
        Math.min(9, Math.max(0, forward)) * .18 -
        laneRisk * (2 + 2.1 * recognition) -
        interceptionPenalty -
        Math.max(0, 6 - nearestOpponentM) * (1.7 + recognition) -
        trajectoryUncertainty * 1.3 -
        Math.max(0, 5 - boundaryGap) * 2 -
        Math.max(0, d - 20) * .26 -
        uncontrolledPenalty -
        (forecast.landingOutsidePitch ? 24 : 0) -
        (forecast.receptionSeconds ?? 3.5) * .45
      assessments.push({
        kind: 'throw', teamId: keeper.clubId,
        playerId: keeper.playerId, receiverId: receiver.playerId,
        target, power, utility, forecast,
        nearestOpponentM, laneRisk,
      })
    }
  }
  return assessments.sort((a, b) =>
    b.utility - a.utility ||
    a.receiverId.localeCompare(b.receiverId) ||
    a.power - b.power)
}

/**
 * Secure hands first; wait for a physically reachable, safer outlet where
 * possible. A bounded fallback avoids the keeper holding indefinitely
 * when no receiver has a trustworthy nominal interception forecast.
 * The fallback is intentionally risky, not an awarded successful pass.
 */
export function chooseGoalkeeperThrow(
  state: MatchState, setup: MatchSetup,
): GoalkeeperThrowChoice | null {
  const caught = activeGoalkeeperCatch(state)
  if (!caught) return null
  const keeper = state.players.find(p => p.playerId === caught.playerId)
  if (!keeper) return null
  const opponents = state.players.filter(p => p.clubId !== keeper.clubId)
  const nearestDanger = opponents.reduce((d, p) =>
    Math.min(d, distance(p.position, keeper.position)), 100)
  const holdTicks = nearestDanger < 9
    ? GOALKEEPER_HOLD_MIN_TICKS + 5
    : GOALKEEPER_HOLD_MIN_TICKS + 18
  const heldTicks = state.clock.tick - caught.tick
  if (heldTicks < holdTicks) return null
  const assessed = assessGoalkeeperThrowOptions(state, setup)
  const credible = assessed.find(a =>
    a.forecast.canControl &&
    (a.forecast.opponentEtaSeconds === null ||
      a.forecast.receptionSeconds === null ||
      a.forecast.opponentEtaSeconds + .12 >= a.forecast.receptionSeconds))
  // A short period of surveying can let the earlier 6.9K receivers move
  // into genuine space. Still release by 4 seconds if no strong option
  // materializes, rather than spin forever.
  const selected = credible ??
    (heldTicks >= 78 ? assessed[0] : null)
  if (!selected) return null
  return {
    kind: 'throw', teamId: selected.teamId,
    playerId: selected.playerId, receiverId: selected.receiverId,
    target: selected.target, power: selected.power,
  }
}
