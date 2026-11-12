import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { MatchState, PlayerMatchState } from '../match/state'
import { activePassIntent, intendedReceiverTarget } from './pass-coordination'
import { attackingOpportunityAt } from './goal-directed'
import { laneObstruction } from './possession'
import { boundedTarget, separationM } from './coordination'

/**
 * Phase 6.9G: The "third man" is a physical support RUNNER, not a scripted
 * one-two, reception, shot or goal. The first pass must already have been
 * kicked for real. An open central attacking lane must exist, and only one
 * midfielder/striker receives the extra instruction.
 */
export const COMBINATION_RUNS_VERSION = 'physical-third-man-support-v1'
const MAX_RUN_DISTANCE_M = 18
const MIN_RUN_GAP_M = 5.5
const MAX_PASS_AGE_TICKS = 26

export interface ThirdManRun {
  readonly playerId: string
  readonly target: Point2
  /** Support utility bonus, not a success probability. */
  readonly utilityBonus: number
  readonly initialReceiverId: string
}

const nearOpponent = (point: Point2,
  opponents: readonly PlayerMatchState[]) =>
  opponents.reduce((gap, p) =>
    Math.min(gap, separationM(point, p.position)), 100)

const isCentralRunner = (player: PlayerMatchState) =>
  player.formationSlot === 'ST' ||
  player.formationSlot === 'RCM' ||
  player.formationSlot === 'LCM'

/**
 * Plan a future outlet BEHIND an actual incoming pass (a third-man run).
 * Nobody is commanded to touch the ball, and the existing receiver keeps
 * exclusive interception priority. The physical match may never complete
 * this combination if a defender gets there first.
 */
export function planThirdManRun(
  state: MatchState, setup: MatchSetup, teamId: string,
): ThirdManRun | null {
  const intent = activePassIntent(state)
  if (!intent || intent.teamId !== teamId ||
      state.ball.controllerId !== null || state.ball.outsidePitch ||
      state.ball.lastTouchPlayerId !== intent.passerId ||
      state.clock.tick - intent.requestedTick > MAX_PASS_AGE_TICKS ||
      !state.contactEvents.some(e =>
        e.commandId === intent.commandId && e.outcome === 'kicked'))
    return null

  const team = state.teams.find(t => t.clubId === teamId)
  const receiver = state.players.find(p => p.playerId === intent.receiverId)
  if (!team || !receiver || receiver.formationSlot === 'GK') return null

  const reference = intendedReceiverTarget(state, setup, intent)
  const goalDistance = team.attackingDirection === 1
    ? setup.pitch.lengthM - reference.xM : reference.xM
  if (goalDistance < 13 || goalDistance > 41) return null

  const opponents = state.players.filter(p => p.clubId !== teamId)
  const forward = (point: Point2) =>
    point.xM * team.attackingDirection
  const secondLastDefender = opponents
    .map(p => forward(p.position))
    .sort((a, b) => b - a)[1]
  // Position ceiling is *advice*, not an official offside adjudication.
  // Keep runs behind the approximate second-last defender, or level with
  // the ball if the defence is already upfield.
  const ceiling = Math.max(
    forward(reference),
    (secondLastDefender ?? forward(reference)) - 1.4,
  )
  const centreY = setup.pitch.widthM / 2

  let best: { player: PlayerMatchState; target: Point2;
    score: number; bonus: number } | null = null
  for (const runner of state.players) {
    if (runner.clubId !== teamId || !isCentralRunner(runner) ||
        runner.playerId === intent.receiverId ||
        runner.playerId === intent.passerId) continue
    const original = state.ai.formationPositions[runner.playerId]
    if (!original) continue

    for (const advance of [7, 11]) {
      for (const lateral of [-9, -5, 0, 5, 9]) {
        const target = boundedTarget({
          xM: reference.xM + team.attackingDirection * advance,
          yM: reference.yM + lateral,
        }, setup.pitch)
        const progress = forward(target)
        if (progress > ceiling + .01) continue
        // Two midfield half-spaces stay distinct. The centre-forward may
        // arrive centrally but should not crowd the existing receiver.
        const yDelta = (target.yM - centreY) *
          team.attackingDirection
        if ((runner.formationSlot === 'RCM' && yDelta < 3) ||
            (runner.formationSlot === 'LCM' && yDelta > -3) ||
            (runner.formationSlot === 'ST' && Math.abs(yDelta) > 11))
          continue
        const run = separationM(runner.position, target)
        const gap = separationM(reference, target)
        if (run > MAX_RUN_DISTANCE_M || run < 2.5 ||
            gap < MIN_RUN_GAP_M || gap > 20 ||
            separationM(target, original) > 38) continue

        const defenderGap = nearOpponent(target, opponents)
        const obstruction = laneObstruction(reference, target, opponents)
        if (defenderGap < 5 || obstruction > 1.4) continue
        const chance = attackingOpportunityAt(target, team, setup, opponents)
        if (chance <= 1.5) continue
        const score = chance * 1.5 +
          Math.min(defenderGap, 10) * .6 -
          run * .33 - obstruction * 3.5
        // Real shot geometry is useful, but cannot completely dominate
        // teammate spacing or the separate short-pass viability engine.
        const bonus = 5 + Math.min(15, chance * 1.2)
        if (!best || score > best.score + 1e-8 ||
            (Math.abs(score - best.score) < 1e-8 &&
              runner.playerId < best.player.playerId)) {
          best = {player: runner, target, score, bonus}
        }
      }
    }
  }
  return best ? {
    playerId: best.player.playerId,
    target: best.target,
    utilityBonus: best.bonus,
    initialReceiverId: intent.receiverId,
  } : null
}
