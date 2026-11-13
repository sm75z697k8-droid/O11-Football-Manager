import type { MatchSetup } from '../model/match'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { BallMatchState, MatchState, OutOfPlayEvent, PlayerMatchState } from './state'
import { BALL_RADIUS_M } from '../physics/ball'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { scheduleMatchCommand } from './commands'

/**
 * S1.1: genuine touchline awards and deliberate legal throw-in releases.
 * This is an incremental restart foundation; corners and goal kicks are
 * classified but left as explicit stoppages until their own restart rules.
 */
export const OUT_OF_PLAY_VERSION = 'touchline-throw-in-continuity-s11-v1'
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

type Edge = OutOfPlayEvent['side']
interface EdgeCrossing {
  readonly side: Edge
  readonly fraction: number
  readonly point: Point2
}

/** The earliest crossed PAINTED line, used only after the whole ball is
 * physically outside. This avoids incorrectly awarding a throw when a
 * diagonal kick crossed a goal line first near the corner flag.
 */
function firstCrossedLine(
  from: Point2, to: Point2, pitch: PitchDefinition,
): EdgeCrossing | null {
  const edges: EdgeCrossing[] = []
  const consider = (side: Edge, coordinate: number,
    origin: number, end: number, isX: boolean) => {
    const delta = end - origin
    if (Math.abs(delta) < 1e-10) return
    const crossedOut = coordinate === 0 ? delta < 0 : delta > 0
    const extent = isX ? pitch.lengthM : pitch.widthM
    if (!crossedOut || coordinate !== (coordinate === 0 ? 0 : extent)) return
    const fraction = (coordinate - origin) / delta
    if (fraction < 0 || fraction > 1) return
    const xM = from.xM + (to.xM - from.xM) * fraction
    const yM = from.yM + (to.yM - from.yM) * fraction
    // Crossing past a corner along the already-extended line still
    // belongs to whichever line was reached first.
    edges.push({ side, fraction, point: { xM, yM } })
  }
  consider('left', 0, from.xM, to.xM, true)
  consider('right', pitch.lengthM, from.xM, to.xM, true)
  consider('top', 0, from.yM, to.yM, false)
  consider('bottom', pitch.widthM, from.yM, to.yM, false)
  edges.sort((a, b) => a.fraction - b.fraction ||
    a.side.localeCompare(b.side))
  if (edges.length) return edges[0]
  // A sphere can be partially outside the chalk without being wholly out
  // until a subsequent physics tick. In that case the first line was
  // crossed earlier; use the already-exterior axis.
  if (from.yM < 0 || from.yM > pitch.widthM) {
    const side = from.yM < 0 ? 'top' : 'bottom'
    return {
      side, fraction: 0,
      point: { xM: from.xM, yM: side === 'top' ? 0 : pitch.widthM },
    }
  }
  if (from.xM < 0 || from.xM > pitch.lengthM) {
    const side = from.xM < 0 ? 'left' : 'right'
    return {
      side, fraction: 0,
      point: { xM: side === 'left' ? 0 : pitch.lengthM, yM: from.yM },
    }
  }
  return null
}

function pickThrower(
  players: readonly PlayerMatchState[], teamId: string, spot: Point2,
): string {
  const candidates = players.filter(p =>
    p.clubId === teamId && p.formationSlot !== 'GK')
  candidates.sort((a, b) => {
    const distance = (p: PlayerMatchState) =>
      Math.hypot(p.position.xM - spot.xM, p.position.yM - spot.yM)
    const preferred = (p: PlayerMatchState) =>
      p.formationSlot === 'LB' || p.formationSlot === 'RB' ? 1.5 : 0
    return distance(a) - preferred(a) -
      (distance(b) - preferred(b)) ||
      a.playerId.localeCompare(b.playerId)
  })
  if (!candidates[0]) throw new Error('No outfield throw-in taker')
  return candidates[0].playerId
}

export function classifyOutOfPlay(
  before: MatchState, after: MatchState, setup: MatchSetup,
): OutOfPlayEvent | null {
  if (before.ball.outsidePitch || !after.ball.outsidePitch ||
      after.goalEvents.length > before.goalEvents.length) return null
  const lastTouch = after.players.find(p =>
    p.playerId === after.ball.lastTouchPlayerId)
  const edge = firstCrossedLine(
    before.ball.position, after.ball.position, setup.pitch)
  if (!edge) return null
  const { lengthM, widthM } = setup.pitch
  const touchline = edge.side === 'top' || edge.side === 'bottom'
  const spot = {
    xM: clamp(edge.point.xM, .35, lengthM - .35),
    yM: touchline ? edge.side === 'top' ? 0 : widthM :
      clamp(edge.point.yM, .35, widthM - .35),
  }
  let kind: OutOfPlayEvent['kind'] = 'unassigned'
  let awardedTeamId: string | null = null
  if (lastTouch) {
    if (touchline) {
      kind = 'throwIn'
      awardedTeamId = after.teams.find(t =>
        t.clubId !== lastTouch.clubId)?.clubId ?? null
    } else {
      const defending = after.teams.find(t =>
        t.attackingDirection === (edge.side === 'left' ? 1 : -1))
      if (!defending) throw new Error('No defending club at goal line')
      const defenderTouched = lastTouch.clubId === defending.clubId
      kind = defenderTouched ? 'corner' : 'goalKick'
      awardedTeamId = defenderTouched
        ? after.teams.find(t => t.clubId !== defending.clubId)?.clubId ?? null
        : defending.clubId
    }
  }
  const takerId = kind === 'throwIn' && awardedTeamId
    ? pickThrower(after.players, awardedTeamId, spot) : null
  return {
    tick: after.clock.tick, side: edge.side, spot,
    kind, awardedTeamId, lastTouchPlayerId: lastTouch?.playerId ?? null,
    takerId,
  }
}

/** Classification occurs only once after physical play and goal judging;
 * it does not presume a kick, change scores, or return ball possession.
 */
export function recordOutOfPlay(
  before: MatchState, after: MatchState, setup: MatchSetup,
): MatchState {
  const event = classifyOutOfPlay(before, after, setup)
  if (!event) return after
  const ball: BallMatchState = {
    ...after.ball, controllerId: null, controlOffset: null,
    heightM: BALL_RADIUS_M,
    velocity: { xMps: 0, yMps: 0, zMps: 0 },
  }
  return {
    ...after, ball, restart: event,
    outOfPlayEvents: [...after.outOfPlayEvents, event],
    ai: { ...after.ai, passIntent: null, decisionSnapshot: [] },
  }
}

export function throwInTakerTarget(event: OutOfPlayEvent, setup: MatchSetup): Point2 {
  return {
    xM: clamp(event.spot.xM, .35, setup.pitch.lengthM - .35),
    yM: event.side === 'top' ? .48 : setup.pitch.widthM - .48,
  }
}

/** Two physically mobile short receiving options, on opposite sides of the
 * taker along the pitch. Their real ability, marking and incoming ball flight
 * determine whether either succeeds.
 */
export function throwInReceiverTargets(
  event: OutOfPlayEvent, setup: MatchSetup,
): readonly [Point2, Point2] {
  const dir = setup.clubs[0].id === event.awardedTeamId ? 1 : -1
  const inward = event.side === 'top' ? 1 : -1
  return [
    { xM: clamp(event.spot.xM + dir * 8, 2.5, setup.pitch.lengthM - 2.5),
      yM: clamp(event.spot.yM + inward * 7.2, 2.5, setup.pitch.widthM - 2.5) },
    { xM: clamp(event.spot.xM - dir * 5.5, 2.5, setup.pitch.lengthM - 2.5),
      yM: clamp(event.spot.yM + inward * 9, 2.5, setup.pitch.widthM - 2.5) },
  ]
}

export function stageThrowIn(
  state: MatchState, setup: MatchSetup,
): MatchState {
  const event = state.restart
  if (event?.kind !== 'throwIn' || !event.awardedTeamId ||
      !event.takerId) return state

  const taker = state.players.find(p => p.playerId === event.takerId)
  if (!taker) throw new Error('Missing throw-in taker')
  const takerTarget = throwInTakerTarget(event, setup)
  const options = state.players.filter(p =>
    p.clubId === event.awardedTeamId &&
    p.playerId !== event.takerId && p.formationSlot !== 'GK')
    .sort((a, b) =>
      Math.hypot(a.position.xM - event.spot.xM,
        a.position.yM - event.spot.yM) -
      Math.hypot(b.position.xM - event.spot.xM,
        b.position.yM - event.spot.yM) ||
      a.playerId.localeCompare(b.playerId))
  const receivers = options.slice(0, 2)
  const targets = throwInReceiverTargets(event, setup)
  const byId = new Map<string, Point2>([
    [event.takerId, takerTarget],
    ...receivers.map((p, index) =>
      [p.playerId, targets[index]] as [string, Point2]),
  ])
  const players = state.players.map(p => {
    const target = byId.get(p.playerId) ?? p.position
    const same = p.intention.kind === 'moveToPoint' &&
      Math.hypot(p.intention.target.xM - target.xM,
        p.intention.target.yM - target.yM) < .2
    return {
      ...p, engagesBall: false,
      intention: same ? p.intention : {
        kind: 'moveToPoint' as const,
        sinceTick: state.clock.tick, target: { ...target },
      },
    }
  })
  let staged = {
    ...state, players,
    ai: { ...state.ai, decisionSnapshot: [] },
  }
  const travelled = Math.hypot(taker.position.xM - takerTarget.xM,
    taker.position.yM - takerTarget.yM)
  const receiverReady = receivers.some((p, index) =>
    Math.hypot(p.position.xM - targets[index].xM,
      p.position.yM - targets[index].yM) < 2.0)
  const pending = staged.pendingCommands.some(c =>
    c.type === 'attemptThrowIn' && c.commandId === 'ai-restart-throwin-' + event.tick)
  const aiIndex = staged.teams.findIndex(t => t.clubId === event.awardedTeamId)
  if (aiIndex >= 0 && staged.ai.enabledTeams[aiIndex] &&
      travelled < .8 && receiverReady &&
      state.clock.tick - event.tick >= 14 && !pending) {
    const nearest = receivers.find((p, index) =>
      Math.hypot(p.position.xM - targets[index].xM,
        p.position.yM - targets[index].yM) < 2.0)!
    const target = nearest.position
    const receipt = scheduleMatchCommand(staged, {
      commandId: 'ai-restart-throwin-' + event.tick,
      type: 'attemptThrowIn',
      teamId: event.awardedTeamId,
      playerId: event.takerId,
      target: { ...target },
      power: .59,
    }, setup.pitch)
    if (!receipt.receipt.accepted) {
      throw new Error('Could not stage legal throw-in: ' + receipt.receipt.reason)
    }
    staged = receipt.state
  }
  return staged
}

/** During a stoppage the footballers still walk/run to the throw-in and
 * receiving points using ordinary acceleration and braking, while the ball
 * remains out until a real command launches it from the touchline.
 */
export function advanceThrowInStoppage(
  state: MatchState, setup: MatchSetup,
  resolveContact: (state: MatchState, setup: MatchSetup) => MatchState,
): MatchState {
  const staged = stageThrowIn(state, setup)
  const moved = advancePlayerLocomotion(
    staged, setup.players, setup.pitch)
  const contacted = resolveContact(moved, setup)
  if (!contacted.contactEvents.some(c =>
    c.tick === contacted.clock.tick &&
    c.kind === 'throwIn' && c.outcome === 'thrownIn')) return contacted
  return { ...contacted, restart: null }
}
