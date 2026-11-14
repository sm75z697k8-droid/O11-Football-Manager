import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, separationM } from './coordination'

/**
 * PRS-S1.2 — Central cover shadows. Deterministic tactical TARGETS only:
 * actual movement, contact, possession and fouls remain with physics.
 * We consider real visible opponents and a short (<= .35s) projected
 * position; we do not read the attacker's future pass decision.
 */
export const CENTRAL_PRESSING_VERSION = 'central-cover-shadow-prs-s12-v1'

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

interface ForwardOutlet {
  readonly opponent: PlayerMatchState
  readonly point: Point2
  readonly dx: number
  readonly dy: number
  readonly length: number
  readonly advance: number
  readonly threat: number
}

export interface CentralPressingPlan {
  readonly presserId: string
  readonly approachTarget: Point2
  readonly jockeyTarget: Point2
  readonly shadowedOutletId: string
  readonly screenerId: string | null
  readonly screenTarget: Point2 | null
  readonly screenedOutletId: string | null
}

function projectedPoint(player: PlayerMatchState, setup: MatchSetup): Point2 {
  return boundedTarget({
    xM: player.position.xM + clamp(player.velocity.xMps * .35, -1.8, 1.8),
    yM: player.position.yM + clamp(player.velocity.yMps * .35, -1.8, 1.8),
  }, setup.pitch)
}

/** Rank only real, potentially receivable forward passes. */
function forwardOutlets(
  state: MatchState, setup: MatchSetup, team: TeamMatchState,
  carrierId: string, ball: Point2,
): ForwardOutlet[] {
  const centralY = setup.pitch.widthM / 2
  const options: ForwardOutlet[] = []
  for (const opponent of state.players) {
    if (opponent.clubId === team.clubId ||
        opponent.playerId === carrierId ||
        opponent.formationSlot === 'GK') continue

    const point = projectedPoint(opponent, setup)
    const dx = point.xM - ball.xM
    const dy = point.yM - ball.yM
    const length = Math.hypot(dx, dy)
    const advance = (ball.xM - point.xM) * team.attackingDirection
    if (length < 7 || length > 30 || advance < 5 || advance > 29 ||
        Math.abs(dy) > 19) continue

    // Forward penetration matters, but a centrally situated receiver
    // also represents a clearer immediate route to the defending goal.
    // These are estimated priority scores, NOT pass success probabilities.
    const centrality = Math.max(0, 18 - Math.abs(point.yM - centralY))
    const threat = advance * .31 + centrality * .14 -
      length * .065 + (opponent.formationSlot === 'ST' ? 1 : 0)
    options.push({ opponent, point, dx, dy, length, advance, threat })
  }
  options.sort((a, b) => b.threat - a.threat ||
    (a.opponent.playerId < b.opponent.playerId ? -1 :
      a.opponent.playerId > b.opponent.playerId ? 1 : 0))
  return options
}

function segmentPoint(
  ball: Point2, outlet: ForwardOutlet, screener: PlayerMatchState,
  setup: MatchSetup,
): Point2 {
  const along = ((screener.position.xM - ball.xM) * outlet.dx +
    (screener.position.yM - ball.yM) * outlet.dy) /
    (outlet.length * outlet.length)
  const t = clamp(along, .38, .80)
  return boundedTarget({
    xM: ball.xM + outlet.dx * t,
    yM: ball.yM + outlet.dy * t,
  }, setup.pitch)
}

/**
 * Deny the most dangerous central forward outlet with the primary presser's
 * *approach*, not a fake intercept. Another nearby midfield/wing defender
 * may screen a DIFFERENT forward lane, while the cover player stays home.
 * Null means retain existing pressing and individual defensive decisions.
 */
export function planCentralPressing(
  state: MatchState, setup: MatchSetup, team: TeamMatchState,
  ball: Point2, pressers: readonly PlayerMatchState[],
  cover: PlayerMatchState | null,
  recovery: ReadonlyMap<string, Point2>,
): CentralPressingPlan | null {
  if (team.pressingIntensity === 'low' || state.ball.outsidePitch ||
      state.ball.controllerId === null || !cover || pressers.length === 0)
    return null

  // Keep touchline work under S1.1, and keep emergency goalmouth
  // challenges direct instead of forcing a tactical cover-shadow arc.
  const distanceToLine = Math.min(ball.yM, setup.pitch.widthM - ball.yM)
  const ownGoalDistance = team.attackingDirection === 1
    ? ball.xM : setup.pitch.lengthM - ball.xM
  if (distanceToLine < 16 || ownGoalDistance < 23) return null

  const carrier = state.players.find(player =>
    player.playerId === state.ball.controllerId && player.clubId !== team.clubId)
  if (!carrier || carrier.formationSlot === 'GK') return null

  const primary = pressers[0]
  const gap = separationM(primary.position, ball)
  const maximumPressGap = team.pressingIntensity === 'high' ? 16 : 11
  // No coordinated press when the defensive unit cannot reach it. Cover
  // must be reasonably close to prevent abandoning the central space.
  const maxCoverGap = team.pressingIntensity === 'high' ? 23 : 19
  if (gap > maximumPressGap ||
      separationM(cover.position, ball) > maxCoverGap) return null

  const options = forwardOutlets(state, setup, team, carrier.playerId, ball)
  if (!options.length) return null
  const mainLane = options[0]
  const ux = mainLane.dx / mainLane.length
  const uy = mainLane.dy / mainLane.length

  // At distance, bend approach toward the ball's forward-pass direction;
  // close range always returns to a physical challenge at the actual ball.
  // A jockey holds a non-engaging goal-side point ON the dangerous lane.
  const shadowOffset = clamp(
    1.4 + gap * .08, 1.55, 2.45)
  // The better the presser reads play, the more fully they can shape
  // their run toward the threatening lane. Less aware players retain
  // more of the old goal-side ball-oriented closing angle.
  const primaryProfile = setup.players.find(p => p.id === primary.playerId)
  const reading = primaryProfile ? (
    .45 * primaryProfile.abilities.mental.anticipation +
    .35 * primaryProfile.abilities.mental.decisions +
    .20 * primaryProfile.abilities.mental.defensivePositioning) / 100 : .5
  const awareness = clamp((reading - .27) * 1.4, .25, .94)
  const standard = {
    xM: ball.xM - team.attackingDirection * 1.9,
    yM: ball.yM + clamp(
      (primary.position.yM - ball.yM) * .16, -1.3, 1.3),
  }
  const shadowTarget = boundedTarget({
    xM: standard.xM * (1 - awareness) +
      (ball.xM + ux * shadowOffset) * awareness,
    yM: standard.yM * (1 - awareness) +
      (ball.yM + uy * shadowOffset) * awareness,
  }, setup.pitch)
  const approachTarget = gap <= 3.5
    ? boundedTarget(ball, setup.pitch) : shadowTarget
  const jockeyTarget = boundedTarget({
    xM: ball.xM + ux * 1.5,
    yM: ball.yM + uy * 1.5,
  }, setup.pitch)

  const unavailable = new Set(pressers.map(p => p.playerId))
  unavailable.add(cover.playerId)

  let best: {
    readonly defender: PlayerMatchState
    readonly outlet: ForwardOutlet
    readonly point: Point2
    readonly score: number
  } | null = null
  const maxTravel = team.pressingIntensity === 'high' ? 13 : 10
  const maxShift = team.pressingIntensity === 'high' ? 14 : 11

  // Only a DIFFERENT lane warrants a second player. A duplicate screen
  // creates a useless group chasing the ball instead of a passing network.
  for (const outlet of options.slice(1)) {
    const separationAngle = Math.abs(
      mainLane.dx * outlet.dy - mainLane.dy * outlet.dx) /
      (mainLane.length * outlet.length)
    if (separationAngle < .28) continue

    for (const player of state.players) {
      if (player.clubId !== team.clubId ||
          player.formationSlot === 'GK' ||
          player.formationSlot === 'RCB' ||
          player.formationSlot === 'LCB' ||
          player.formationSlot === 'ST' ||
          unavailable.has(player.playerId)) continue

      const block = recovery.get(player.playerId)
      if (!block) continue
      const point = segmentPoint(ball, outlet, player, setup)
      const travel = separationM(player.position, point)
      const shift = separationM(block, point)
      if (travel > maxTravel || shift > maxShift ||
          separationM(point, ball) < 4.5 ||
          separationM(point, primary.position) < 2.4 ||
          separationM(point, cover.position) < 2.5) continue

      const profile = setup.players.find(p => p.id === player.playerId)
      if (!profile) continue
      const intelligence = (
        .38 * profile.abilities.mental.anticipation +
        .32 * profile.abilities.mental.defensivePositioning +
        .18 * profile.abilities.mental.decisions +
        .12 * profile.abilities.mental.teamwork) / 100
      const roleBonus = player.formationSlot === 'DM' ? 1.3 :
        player.formationSlot === 'RCM' || player.formationSlot === 'LCM'
          ? 1.9 : .2
      const previous = state.ai.decisionSnapshot.find(d =>
        d.playerId === player.playerId && d.action === 'screen')
      const continuity = previous &&
        separationM(previous.target, point) < 2.5 ? 1.15 : 0
      const score = outlet.threat * .36 + intelligence * 2 +
        roleBonus + continuity - travel * .55 - shift * .30
      if (!best || score > best.score + 1e-8 ||
          (Math.abs(score - best.score) <= 1e-8 &&
           (player.playerId < best.defender.playerId ||
            (player.playerId === best.defender.playerId &&
              outlet.opponent.playerId < best.outlet.opponent.playerId)))) {
        best = { defender: player, outlet, point, score }
      }
    }
  }

  return {
    presserId: primary.playerId,
    approachTarget, jockeyTarget,
    shadowedOutletId: mainLane.opponent.playerId,
    screenerId: best?.defender.playerId ?? null,
    screenTarget: best?.point ?? null,
    screenedOutletId: best?.outlet.opponent.playerId ?? null,
  }
}
