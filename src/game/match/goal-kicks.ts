import type { MatchSetup } from '../model/match'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { MatchState, OutOfPlayEvent, PlayerMatchState } from './state'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { scheduleMatchCommand } from './commands'

/**
 * S1.2: genuine Law 16 placement, 20Hz build-up, opponent clearance and
 * a physically executed foot kick. No instant possession, no forced pass.
 *
 * The ball is DEAD while restart is non-null, even though its goal-area
 * placement is geometrically inside the pitch. Ordinary play cannot run.
 */
export const GOAL_KICK_VERSION = 'goal-area-physical-restarts-s12-v1'
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)

export function goalKickSpot(
  event: OutOfPlayEvent, pitch: PitchDefinition,
): Point2 {
  if (event.kind !== 'goalKick' ||
      !['left','right'].includes(event.side)) {
    throw new Error('Goal-area placement requires a real goal kick')
  }
  const depth = clamp(pitch.goalAreaDepthM - 1.15, .8, pitch.goalAreaDepthM - .25)
  const lateral = clamp(pitch.goalAreaWidthM / 2 - 3.5, 1.5, 5.5)
  return {
    xM: event.side === 'left' ? depth : pitch.lengthM - depth,
    yM: pitch.widthM / 2 +
      (event.spot.yM <= pitch.widthM / 2 ? -lateral : lateral),
  }
}

export function goalKickTaker(
  state: MatchState, event: OutOfPlayEvent,
): PlayerMatchState | null {
  if (event.kind !== 'goalKick') return null
  return state.players.find(p =>
    p.clubId === event.awardedTeamId && p.formationSlot === 'GK') ?? null
}

export function goalKickReceiverTargets(
  event: OutOfPlayEvent, setup: MatchSetup,
): readonly [Point2, Point2] {
  const dir = event.side === 'left' ? 1 : -1
  const goalX = event.side === 'left' ? 0 : setup.pitch.lengthM
  const depth = Math.max(7, setup.pitch.penaltyAreaDepthM - 1.45)
  const half = Math.max(4.5, setup.pitch.penaltyAreaWidthM / 2 - 6)
  return [
    { xM: goalX + dir * depth, yM: setup.pitch.widthM / 2 - half },
    { xM: goalX + dir * depth, yM: setup.pitch.widthM / 2 + half },
  ]
}

export function insideRestartPenaltyArea(
  point: Point2, event: OutOfPlayEvent, pitch: PitchDefinition,
): boolean {
  const depth = event.side === 'left'
    ? point.xM : pitch.lengthM - point.xM
  return depth >= 0 && depth < pitch.penaltyAreaDepthM &&
    Math.abs(point.yM - pitch.widthM / 2) < pitch.penaltyAreaWidthM / 2
}

function clearOpponentTarget(
  player: PlayerMatchState, event: OutOfPlayEvent,
  pitch: PitchDefinition,
): Point2 {
  if (!insideRestartPenaltyArea(player.position, event, pitch)) {
    return player.position
  }
  const dir = event.side === 'left' ? 1 : -1
  const goalX = event.side === 'left' ? 0 : pitch.lengthM
  return {
    xM: goalX + dir * (pitch.penaltyAreaDepthM + 1.65),
    yM: player.position.yM,
  }
}

function nearestOpponentM(
  players: readonly PlayerMatchState[], team: string, point: Point2,
): number {
  let nearest = 120
  for (const p of players) if (p.clubId !== team) {
    nearest = Math.min(nearest, distance(p.position, point))
  }
  return nearest
}

export function stageGoalKick(
  state: MatchState, setup: MatchSetup,
): MatchState {
  const event = state.restart
  if (event?.kind !== 'goalKick' || !event.awardedTeamId) return state
  const awardedTeamId = event.awardedTeamId
  const takingIndex = state.teams.findIndex(t => t.clubId === awardedTeamId)
  if (takingIndex < 0 || !state.ai.enabledTeams[takingIndex]) return state

  const keeper = goalKickTaker(state, event)
  if (!keeper) throw new Error('Goal kick has no defending goalkeeper')
  const definition = setup.players.find(p => p.id === keeper.playerId)
  if (!definition?.abilities.goalkeeping) {
    throw new Error('Goal kick taker lacks real goalkeeper attributes')
  }
  const dir = event.side === 'left' ? 1 : -1
  const ballSpot = goalKickSpot(event, setup.pitch)
  const keeperTarget = {
    xM: ballSpot.xM + dir * .43,
    yM: ballSpot.yM,
  }
  const [rcb, lcb] = ['RCB', 'LCB'].map(slot =>
    state.players.find(p => p.clubId === awardedTeamId &&
      p.formationSlot === slot))
  if (!rcb || !lcb) throw new Error('No central defenders for goal-kick outlets')
  const receiverTargets = goalKickReceiverTargets(event, setup)
  const designated = new Map<string, Point2>([
    [keeper.playerId, keeperTarget],
    [rcb.playerId, receiverTargets[0]],
    [lcb.playerId, receiverTargets[1]],
  ])

  // Both teams obey restart positioning; everyone moves by the existing
  // acceleration and turning integrator, never a reset/teleport.
  const players = state.players.map(p => {
    const teamIndex = state.teams.findIndex(t => t.clubId === p.clubId)
    if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return p
    const point = p.clubId === awardedTeamId
      ? (designated.get(p.playerId) ?? p.position)
      : clearOpponentTarget(p, event, setup.pitch)
    const unchanged = p.intention.kind === 'moveToPoint' &&
      distance(p.intention.target, point) < .18
    return {
      ...p, engagesBall: false,
      intention: unchanged ? p.intention : {
        kind: 'moveToPoint' as const,
        sinceTick: state.clock.tick, target: { ...point },
      },
    }
  })
  let staged: MatchState = {
    ...state, players,
    ai: { ...state.ai, decisionSnapshot: [] },
  }

  const opponentClear = state.players.every(p =>
    p.clubId === awardedTeamId ||
    !insideRestartPenaltyArea(p.position, event, setup.pitch))
  const keeperReady = distance(keeper.position, ballSpot) <= .85 &&
    Math.hypot(keeper.velocity.xMps, keeper.velocity.yMps) <= 1.7
  const nearbyReceivers = [rcb, lcb].map((p, i) => ({
    player: p, target: receiverTargets[i],
    ready: distance(p.position, receiverTargets[i]) < 2.4,
    space: nearestOpponentM(state.players, awardedTeamId, p.position),
  }))
  const short = nearbyReceivers.filter(r => r.ready).sort((a, b) =>
    b.space - a.space ||
    a.player.playerId.localeCompare(b.player.playerId))[0]
  const pending = staged.pendingCommands.some(c => c.type === 'attemptGoalKick')
  const previousAttempt = [...staged.appliedCommands].reverse().find(c =>
    c.type === 'attemptGoalKick' && c.teamId === awardedTeamId &&
    c.appliedTick > event.tick)
  const previousContact = previousAttempt && state.contactEvents.find(e =>
    e.commandId === previousAttempt.commandId)
  const canRetry = !previousAttempt ||
    (previousContact?.outcome !== 'goalKicked' &&
      state.clock.tick - previousAttempt.appliedTick >= 8)

  if (keeperReady && opponentClear && short && !pending && canRetry &&
      state.clock.tick - event.tick >= 14) {
    const goalkeeping = definition.abilities.goalkeeping
    // This is a limited choice between safer short build-up and a midfield
    // release when both centre-backs are marked; no assumed completion.
    const underPressure = short.space < 5.8
    const goalX = event.side === 'left' ? 0 : setup.pitch.lengthM
    const fallback = state.players.filter(p =>
      p.clubId === awardedTeamId &&
      ['DM', 'RCM', 'LCM'].includes(p.formationSlot) &&
      // A midfielder can be goal-side of the keeper after a defensive
      // scramble. Never propose that player as an illegal outward kick.
      (p.position.xM - goalX) * dir > setup.pitch.goalAreaDepthM + 4 &&
      distance(ballSpot, p.position) >= 9)
      .sort((a, b) =>
        nearestOpponentM(state.players, awardedTeamId, b.position) -
          nearestOpponentM(state.players, awardedTeamId, a.position) ||
        a.playerId.localeCompare(b.playerId))[0]
    const useLong = underPressure && !!fallback &&
      (goalkeeping.kickingDistribution >= 54 ||
        state.clock.tick - event.tick > 115)
    const receiver = useLong ? fallback : short.player
    const target = useLong ? { ...receiver.position } : { ...short.player.position }
    const d = distance(ballSpot, target)
    const long = d > 24
    const accuracy = (
      .58 * goalkeeping.kickingDistribution +
      .25 * definition.abilities.technical.passing +
      .17 * definition.abilities.mental.composure) / 100
    const strikeFactor = 14 + .13 * definition.abilities.physical.strength +
      .065 * definition.abilities.technical.technique
    const desiredSpeed = long ? clamp(d * .8, 19, 35) :
      clamp(d / 1.18, 7, 18)
    const power = clamp((desiredSpeed / (.9 + .1 * accuracy) - 3) /
      strikeFactor, .13, 1)
    const commandId = 'ai-pass-goalkick-' + event.tick +
      '-' + staged.nextCommandSequence
    const receipt = scheduleMatchCommand(staged, {
      commandId, type: 'attemptGoalKick',
      teamId: awardedTeamId,
      playerId: keeper.playerId,
      target, power, lift: long ? .42 : 0,
    }, setup.pitch)
    if (!receipt.receipt.accepted) {
      throw new Error('Cannot schedule legal goal kick: ' + receipt.receipt.reason)
    }
    staged = {
      ...receipt.state,
      ai: {
        ...receipt.state.ai,
        lastPassTick: state.clock.tick,
        passIntent: {
          commandId, teamId: awardedTeamId,
          passerId: keeper.playerId,
          receiverId: receiver.playerId,
          requestedTick: state.clock.tick,
          target,
        },
      },
    }
  }
  return staged
}

/** Normal AI and collisions remain paused while a real physical restart
 * runs. The ball waits stationary at the legal goal-area spot until foot
 * contact produces a successful 'goalKicked' event.
 */
export function advanceGoalKickStoppage(
  state: MatchState, setup: MatchSetup,
  resolveContact: (state: MatchState, setup: MatchSetup) => MatchState,
): MatchState {
  const prepared = stageGoalKick(state, setup)
  const moved = advancePlayerLocomotion(prepared, setup.players, setup.pitch)
  const contacted = resolveContact(moved, setup)
  if (!contacted.contactEvents.some(e =>
    e.tick === contacted.clock.tick &&
    e.kind === 'goalKick' && e.outcome === 'goalKicked')) return contacted
  return { ...contacted, restart: null }
}
