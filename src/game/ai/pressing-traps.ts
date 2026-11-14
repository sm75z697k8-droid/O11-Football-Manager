import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type {
  MatchState, PlayerMatchState, TeamMatchState,
} from '../match/state'
import { boundedTarget, separationM } from './coordination'

/**
 * S1.1: a physically reachable wide pressing trap, not an awarded
 * interception. A primary presser denies the inside lane while a different
 * defender screens a REAL opponent outlet. Existing cover remains separate.
 *
 * All distances/weights are estimated gameplay heuristics, not tracking data.
 * The ordinary 50ms locomotion, swept-ball contact and foul rules decide
 * whether any movement or challenge succeeds.
 */
export const WIDE_PRESSING_TRAPS_VERSION = 'wide-lane-coordination-s11-v1'
const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value))

export interface WidePressingTrap {
  readonly presserId: string
  readonly approachTarget: Point2
  readonly screenerId: string
  readonly screenTarget: Point2
  readonly outletId: string
}

function projectedOutlet(player: PlayerMatchState, setup: MatchSetup): Point2 {
  // Short anticipation only. Never infer a predetermined pass or receiver.
  return boundedTarget({
    xM: player.position.xM + clamp(player.velocity.xMps * .35, -2, 2),
    yM: player.position.yM + clamp(player.velocity.yMps * .35, -2, 2),
  }, setup.pitch)
}

function laneScreenPoint(
  ball: Point2, outlet: Point2, defender: PlayerMatchState,
  setup: MatchSetup,
): Point2 {
  const dx = outlet.xM - ball.xM
  const dy = outlet.yM - ball.yM
  const lengthSq = dx * dx + dy * dy
  // Candidate lanes have nonzero length, but protect this pure helper too.
  const projection = lengthSq > .01
    ? ((defender.position.xM - ball.xM) * dx +
        (defender.position.yM - ball.yM) * dy) / lengthSq : .5
  // Screen the actual carrier-to-outlet segment, not the ball carrier.
  const t = clamp(projection, .35, .78)
  return boundedTarget({
    xM: ball.xM + dx * t, yM: ball.yM + dy * t,
  }, setup.pitch)
}

/**
 * Return null when any ingredient is missing: current opposition control,
 * a real wide carrier, an eligible direct presser, a plausible inside outlet,
 * and a separate, physically close defender who can screen it without
 * abandoning the recovery block. High intensity offers more scope, but
 * cannot fabricate a trap when the defending unit is out of position.
 */
export function planWidePressingTrap(
  state: MatchState, setup: MatchSetup, team: TeamMatchState,
  ball: Point2, pressers: readonly PlayerMatchState[],
  coverId: string | null,
  recovery: ReadonlyMap<string, Point2>,
): WidePressingTrap | null {
  if (team.pressingIntensity === 'low' || !pressers.length ||
      state.ball.outsidePitch || state.ball.controllerId === null) return null

  const carrier = state.players.find(p =>
    p.playerId === state.ball.controllerId && p.clubId !== team.clubId)
  if (!carrier) return null

  const width = setup.pitch.widthM
  const distanceToLine = Math.min(ball.yM, width - ball.yM)
  if (distanceToLine > 9) return null

  const primary = pressers[0]
  const pressGap = separationM(primary.position, ball)
  if (pressGap > (team.pressingIntensity === 'high' ? 14 : 10))
    return null

  const pressingIds = new Set(pressers.map(p => p.playerId))
  const screeners = state.players.filter(p =>
    p.clubId === team.clubId &&
    p.formationSlot !== 'GK' && p.formationSlot !== 'ST' &&
    p.formationSlot !== 'RCB' && p.formationSlot !== 'LCB' &&
    !pressingIds.has(p.playerId) && p.playerId !== coverId)
  if (!screeners.length) return null

  const center = width / 2
  const maxCurrentTravel = team.pressingIntensity === 'high' ? 12 : 9
  const maxRecoveryShift = team.pressingIntensity === 'high' ? 10 : 8
  let best: {
    readonly defender: PlayerMatchState
    readonly outlet: PlayerMatchState
    readonly target: Point2
    readonly score: number
  } | null = null

  for (const opponent of state.players) {
    if (opponent.clubId === team.clubId ||
        opponent.playerId === carrier.playerId ||
        opponent.formationSlot === 'GK') continue

    const outlet = projectedOutlet(opponent, setup)
    const passLength = separationM(ball, outlet)
    // A wide trap specifically denies a feasible nearby INSIDE option,
    // rather than marking an arbitrary far-side or down-the-line player.
    if (passLength < 7 || passLength > 30) continue
    const interiorGain = Math.abs(ball.yM - center) -
      Math.abs(outlet.yM - center)
    if (interiorGain < 6) continue
    const goalward = (ball.xM - outlet.xM) * team.attackingDirection
    if (goalward < -5) continue

    for (const player of screeners) {
      const block = recovery.get(player.playerId)
      if (!block) continue
      const target = laneScreenPoint(ball, outlet, player, setup)
      const toTarget = separationM(player.position, target)
      const shift = separationM(block, target)
      if (toTarget > maxCurrentTravel || shift > maxRecoveryShift ||
          separationM(target, ball) < 4 ||
          separationM(target, primary.position) < 2.1) continue

      const profile = setup.players.find(p => p.id === player.playerId)
      if (!profile) continue
      const intelligence = (.40 * profile.abilities.mental.defensivePositioning +
        .30 * profile.abilities.mental.anticipation +
        .30 * profile.abilities.mental.decisions) / 100
      const roleFit = player.formationSlot === 'DM' ? 1.1 :
        player.formationSlot === 'RCM' || player.formationSlot === 'LCM'
          ? 1.4 : .3
      // All scores are relative priorities, never tackle probabilities.
      const continuity = state.ai.decisionSnapshot.some(d =>
        d.playerId === player.playerId && d.action === 'mark' &&
        separationM(d.target, target) < 3) ? .8 : 0
      const score = interiorGain * .23 + Math.max(0, goalward) * .12 +
        intelligence * 2 + roleFit + continuity -
        toTarget * .48 - shift * .26 - passLength * .035
      if (!best || score > best.score + 1e-8 ||
          (Math.abs(score - best.score) <= 1e-8 &&
            (player.playerId < best.defender.playerId ||
              (player.playerId === best.defender.playerId &&
                opponent.playerId < best.outlet.playerId)))) {
        best = { defender: player, outlet: opponent, target, score }
      }
    }
  }
  if (!best) return null

  // Approach from the inside toward the touchline, rather than taking the
  // old straight goal-side point. Near-foot defenders still target the real
  // ball for the existing contact solver to evaluate.
  const inside = ball.yM < center ? 1 : -1
  const offset = clamp(
    1.3 + Math.abs(projectedOutlet(best.outlet, setup).yM - ball.yM) * .075,
    1.6, 2.8)
  const approachTarget = pressGap <= 3.5
    ? boundedTarget(ball, setup.pitch)
    : boundedTarget({
      xM: ball.xM - team.attackingDirection * 1.9,
      yM: ball.yM + inside * offset,
    }, setup.pitch)

  return {
    presserId: primary.playerId,
    approachTarget,
    screenerId: best.defender.playerId,
    screenTarget: best.target,
    outletId: best.outlet.playerId,
  }
}
