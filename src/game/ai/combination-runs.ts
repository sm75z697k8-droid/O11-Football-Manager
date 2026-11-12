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
export const COMBINATION_RUNS_VERSION = 'physical-pass-reception-follow-through-v2'
const MAX_RUN_DISTANCE_M = 18
const MIN_RUN_GAP_M = 5.5
const MAX_PASS_AGE_TICKS = 26

export interface ThirdManRun {
  readonly playerId: string
  readonly target: Point2
  /** Support utility bonus, not a success probability. */
  readonly utilityBonus: number
  readonly initialReceiverId: string
  readonly sourcePassId: string
}

const nearOpponent = (point: Point2,
  opponents: readonly PlayerMatchState[]) =>
  opponents.reduce((gap, p) =>
    Math.min(gap, separationM(point, p.position)), 100)

const isCentralRunner = (player: PlayerMatchState) =>
  player.formationSlot === 'ST' ||
  player.formationSlot === 'RCM' ||
  player.formationSlot === 'LCM'

interface CombinationPhase {
  readonly receiverId: string
  readonly passerId: string
  readonly sourcePassId: string
  readonly reference: Point2
}

/** In flight, we observe a real physical kick. After reception, we look
 * for a real controlled first touch by the intended team. Both paths
 * derive entirely from authoritative contact events and ball ownership.
 */
function combinationPhase(
  state: MatchState, setup: MatchSetup, teamId: string,
): CombinationPhase | null {
  if (state.ball.outsidePitch) return null
  const intent = activePassIntent(state)
  if (intent && intent.teamId === teamId &&
      state.ball.controllerId === null &&
      state.ball.lastTouchPlayerId === intent.passerId &&
      state.clock.tick - intent.requestedTick <= MAX_PASS_AGE_TICKS &&
      state.contactEvents.some(e =>
        e.commandId === intent.commandId && e.outcome === 'kicked')) {
    return {
      receiverId: intent.receiverId,
      passerId: intent.passerId,
      sourcePassId: intent.commandId,
      reference: intendedReceiverTarget(state, setup, intent),
    }
  }

  const receiver = state.players.find(p =>
    p.playerId === state.ball.controllerId && p.clubId === teamId)
  if (!receiver || receiver.formationSlot === 'GK' ||
      state.ball.lastTouchPlayerId !== receiver.playerId ||
      state.ball.heightM > .5) return null

  const received = [
    ...state.automaticContactEvents.filter(e =>
      e.playerId === receiver.playerId && e.outcome === 'intercepted'),
    ...state.contactEvents.filter(e =>
      e.playerId === receiver.playerId && e.outcome === 'controlled'),
  ].sort((a,b)=>b.tick-a.tick)[0]
  if (!received || state.clock.tick - received.tick > 22) return null
  const physicalPass = [...state.contactEvents].reverse().find(e =>
    e.commandId.startsWith('ai-pass-') &&
    e.outcome === 'kicked' && e.tick < received.tick &&
    received.tick - e.tick <= 70)
  if (!physicalPass || physicalPass.playerId === receiver.playerId) return null
  const passer = state.players.find(p =>
    p.playerId === physicalPass.playerId && p.clubId === teamId)
  if (!passer) return null
  // Only a genuinely completed same-team control, without an intervening
  // opposition deflection, qualifies as a successful combination receipt.
  const intervening = state.automaticContactEvents.some(e =>
    e.tick > physicalPass.tick && e.tick < received.tick &&
    e.outcome !== 'heldOff')
  if (intervening) return null
  return {
    receiverId: receiver.playerId,
    passerId: passer.playerId,
    sourcePassId: physicalPass.commandId,
    reference: receiver.position,
  }
}

/**
 * Plan a future outlet BEHIND an actual kicked pass, either while the
 * intended receiver chases it or shortly after an actual controlled
 * reception. All locomotion, contacts, and the next kick remain physical.
 */
export function planThirdManRun(
  state: MatchState, setup: MatchSetup, teamId: string,
): ThirdManRun | null {
  const phase = combinationPhase(state, setup, teamId)
  if (!phase) return null
  const team = state.teams.find(t => t.clubId === teamId)
  if (!team) return null
  const reference = phase.reference
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
        runner.playerId === phase.receiverId ||
        runner.playerId === phase.passerId) continue
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
    initialReceiverId: phase.receiverId,
    sourcePassId: phase.sourcePassId,
  } : null
}

/** One controlled wide-ball underlap, never a scripted overlapping pass.
 * The same real-world defender spacing and offside-aware target ceiling
 * used by the third-man planner decide whether this outlet is plausible.
 */
export interface WideUnderlapRun {
  readonly playerId: string
  readonly target: Point2
  readonly utilityBonus: number
  readonly wingerId: string
}

export function planWideUnderlap(
  state: MatchState, setup: MatchSetup, teamId: string,
): WideUnderlapRun | null {
  if (state.ball.outsidePitch || state.ball.heightM > .5) return null
  const carrier = state.players.find(p =>
    p.playerId === state.ball.controllerId && p.clubId === teamId)
  if (!carrier || (carrier.formationSlot !== 'RW' &&
      carrier.formationSlot !== 'LW')) return null
  const team = state.teams.find(t => t.clubId === teamId)
  if (!team) return null
  const direction = team.attackingDirection
  const distanceToGoal = direction === 1
    ? setup.pitch.lengthM - carrier.position.xM : carrier.position.xM
  if (distanceToGoal < 12 || distanceToGoal > 37) return null
  const side = (carrier.formationSlot === 'RW' ? 1 : -1) * direction
  const centre = setup.pitch.widthM / 2
  if ((carrier.position.yM - centre) * side < 11) return null

  const opponents = state.players.filter(p => p.clubId !== teamId)
  const forward = (p: Point2) => p.xM * direction
  const secondDefender = opponents.map(p => forward(p.position))
    .sort((a, b) => b - a)[1]
  const limit = Math.max(
    forward(carrier.position),
    (secondDefender ?? forward(carrier.position)) - 1.4)
  let best: {runner: PlayerMatchState; target: Point2;
    score: number; bonus: number} | null = null
  for (const runner of state.players) {
    if (runner.clubId !== teamId ||
        runner.formationSlot !==
          (carrier.formationSlot === 'RW' ? 'RCM' : 'LCM'))
      continue
    const anchor = state.ai.formationPositions[runner.playerId]
    if (!anchor) continue
    for (const advance of [6, 9]) {
      for (const inside of [7, 10, 13]) {
        const target = boundedTarget({
          xM: carrier.position.xM + direction * advance,
          yM: carrier.position.yM - side * inside,
        }, setup.pitch)
        if (forward(target) > limit + .01 ||
            (target.yM - centre) * side < 3 ||
            separationM(target, anchor) > 38) continue
        const travel = separationM(runner.position, target)
        if (travel < 2.5 || travel > MAX_RUN_DISTANCE_M) continue
        const space = nearOpponent(target, opponents)
        const blocked = laneObstruction(carrier.position, target, opponents)
        if (space < 5.5 || blocked > 1.4) continue
        const chance = attackingOpportunityAt(
          target, team, setup, opponents)
        if (chance <= 1.5) continue
        const score = chance * 1.3 + Math.min(space, 10) * .55 -
          travel * .28 - blocked * 3
        const bonus = 5 + Math.min(14, chance * 1.3)
        if (!best || score > best.score + 1e-8 ||
            (Math.abs(score - best.score) < 1e-8 &&
              runner.playerId < best.runner.playerId)) {
          best = {runner, target, score, bonus}
        }
      }
    }
  }
  return best ? {playerId:best.runner.playerId, target:best.target,
    utilityBonus:best.bonus, wingerId:carrier.playerId} : null
}
