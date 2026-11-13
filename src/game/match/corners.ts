import type { MatchSetup } from '../model/match'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { MatchState, OutOfPlayEvent, PlayerMatchState } from './state'
import { advancePlayerLocomotion } from '../physics/locomotion'
import { scheduleMatchCommand } from './commands'

/**
 * S1.3 - IFAB Law 17 corner restarts.
 * Keep the ball stationary inside the corner arc while real 20Hz locomotion
 * moves the taker and targets. A physical seeded foot-contact kick alone
 * returns play to the ordinary simulation.
 */
export const CORNER_RESTART_VERSION = 'physical-corner-restarts-s13-v1'
export const CORNER_ARC_RADIUS_M = 1
export const CORNER_OPPONENT_CLEAR_M = 9.15 + CORNER_ARC_RADIUS_M
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))
const distance = (a: Point2, b: Point2) =>
  Math.hypot(a.xM - b.xM, a.yM - b.yM)

function cornerVertex(
  event: OutOfPlayEvent, pitch: PitchDefinition,
): Point2 {
  if (event.kind !== 'corner' ||
      (event.side !== 'left' && event.side !== 'right'))
    throw new Error('A physical corner must have a real goal-line award')
  return {
    xM: event.side === 'left' ? 0 : pitch.lengthM,
    yM: event.spot.yM <= pitch.widthM / 2 ? 0 : pitch.widthM,
  }
}

export function cornerBallSpot(
  event: OutOfPlayEvent, pitch: PitchDefinition,
): Point2 {
  const flag = cornerVertex(event, pitch)
  return {
    xM: flag.xM === 0 ? .48 : pitch.lengthM - .48,
    yM: flag.yM === 0 ? .48 : pitch.widthM - .48,
  }
}

export function cornerTakerTarget(
  event: OutOfPlayEvent, pitch: PitchDefinition,
): Point2 {
  const flag = cornerVertex(event, pitch)
  return {
    xM: flag.xM === 0 ? 1.1 : pitch.lengthM - 1.1,
    yM: flag.yM === 0 ? 1.1 : pitch.widthM - 1.1,
  }
}

export function cornerOpponentsClear(
  state: MatchState, event: OutOfPlayEvent,
  pitch: PitchDefinition,
): boolean {
  const flag = cornerVertex(event, pitch)
  return state.players.every(p =>
    p.clubId === event.awardedTeamId ||
    distance(p.position, flag) >= CORNER_OPPONENT_CLEAR_M - .02)
}

/** Select from stable initial tactical anchors so the taker does NOT
 * change when teammates move to prepare the kick.
 */
export function selectCornerTaker(
  state: MatchState, event: OutOfPlayEvent, setup: MatchSetup,
): PlayerMatchState | null {
  if (!event.awardedTeamId || event.kind !== 'corner') return null
  const spot = cornerBallSpot(event, setup.pitch)
  const candidates = state.players.filter(p =>
    p.clubId === event.awardedTeamId && p.formationSlot !== 'GK')
  candidates.sort((a, b) => {
    const merit = (p: PlayerMatchState) => {
      const definition = setup.players.find(q => q.id === p.playerId)
      if (!definition) throw new Error('Corner taker missing match attributes')
      const base = state.ai.formationPositions[p.playerId] ?? p.position
      const wide = ['LW','RW','LB','RB'].includes(p.formationSlot) ? 6 : 0
      const setPiece = .06 * definition.abilities.technical.corners +
        .025 * definition.abilities.technical.crossing
      return distance(base, spot) - wide - setPiece
    }
    return merit(a) - merit(b) || a.playerId.localeCompare(b.playerId)
  })
  return candidates[0] ?? null
}

interface CornerTargets {
  readonly near: Point2
  readonly far: Point2
  readonly short: Point2
}
export function cornerReceiverTargets(
  event: OutOfPlayEvent, pitch: PitchDefinition,
): CornerTargets {
  const flag = cornerVertex(event, pitch)
  const fromGoal = flag.xM === 0 ? 1 : -1
  const nearY = flag.yM === 0 ? -1 : 1
  const centre = pitch.widthM / 2
  return {
    near: { xM: flag.xM + fromGoal * 6.5, yM: centre + nearY * 7 },
    far: { xM: flag.xM + fromGoal * 8.3, yM: centre - nearY * 7 },
    short: {
      xM: flag.xM + fromGoal * 10.8,
      yM: flag.yM === 0 ? 9.2 : pitch.widthM - 9.2,
    },
  }
}

/** The referee's 9.15m is from the ARC, not merely the ball centre. */
export function cornerOpponentRetreatTarget(
  position: Point2, event: OutOfPlayEvent,
  pitch: PitchDefinition,
): Point2 {
  const flag = cornerVertex(event, pitch)
  const dx = position.xM - flag.xM
  const dy = position.yM - flag.yM
  const length = Math.hypot(dx, dy)
  if (length >= CORNER_OPPONENT_CLEAR_M + .12) return position
  const inwardX = flag.xM === 0 ? 1 : -1
  const inwardY = flag.yM === 0 ? 1 : -1
  const ux = length > .01 ? dx / length : inwardX * .7
  const uy = length > .01 ? dy / length : inwardY * .7
  const m = Math.hypot(ux, uy)
  return {
    xM: clamp(flag.xM + ux / m * (CORNER_OPPONENT_CLEAR_M + .65),
      0, pitch.lengthM),
    yM: clamp(flag.yM + uy / m * (CORNER_OPPONENT_CLEAR_M + .65),
      0, pitch.widthM),
  }
}

function nearbyOpponents(
  state: MatchState, teamId: string, target: Point2, range: number,
) {
  return state.players.filter(p =>
    p.clubId !== teamId && distance(p.position, target) <= range).length
}

function pickRole(
  players: readonly PlayerMatchState[], teamId: string,
  excluded: Set<string>, roles: readonly string[],
): PlayerMatchState | null {
  for (const slot of roles) {
    const p = players.find(p => p.clubId === teamId &&
      p.formationSlot === slot && !excluded.has(p.playerId))
    if (p) {
      excluded.add(p.playerId)
      return p
    }
  }
  return null
}

export function stageCorner(
  state: MatchState, setup: MatchSetup,
): MatchState {
  const event = state.restart
  if (!event || event.kind !== 'corner' || !event.awardedTeamId) return state
  const awarded = event.awardedTeamId
  const index = state.teams.findIndex(t => t.clubId === awarded)
  if (index < 0 || !state.ai.enabledTeams[index]) return state
  const taker = selectCornerTaker(state, event, setup)
  if (!taker) throw new Error('Corner awarded without eligible taker')
  const flag = cornerVertex(event, setup.pitch)
  const spot = cornerBallSpot(event, setup.pitch)
  const takerTarget = cornerTakerTarget(event, setup.pitch)
  const targets = cornerReceiverTargets(event, setup.pitch)
  const excluded = new Set([taker.playerId])
  const near = pickRole(state.players, awarded, excluded,
    ['ST','RCB','LCB','AM','RW','LW','DM'])
  const far = pickRole(state.players, awarded, excluded,
    [flag.yM === 0 ? 'RW' : 'LW','RCB','LCB','ST','DM'])
  const short = pickRole(state.players, awarded, excluded,
    [flag.yM === 0 ? 'LW' : 'RW','RCM','LCM','DM','LB','RB'])
  if (!near || !far || !short) throw new Error('Missing corner attack support')
  const targetsById = new Map<string, Point2>([
    [taker.playerId, takerTarget],
    [near.playerId, targets.near],
    [far.playerId, targets.far],
    [short.playerId, targets.short],
  ])
  // Defender and keeper hold the goalmouth using physical runs while all
  // defending players obey the legal corner-arc exclusion.
  const defendingId = state.teams.find(t => t.clubId !== awarded)?.clubId
  if (!defendingId) throw new Error('Corner defending team missing')
  const defendDirection = event.side === 'left' ? 1 : -1
  const defendingKeeper = state.players.find(p =>
    p.clubId === defendingId && p.formationSlot === 'GK')
  const cb1 = state.players.find(p =>
    p.clubId === defendingId && p.formationSlot === 'RCB')
  const cb2 = state.players.find(p =>
    p.clubId === defendingId && p.formationSlot === 'LCB')
  if (defendingKeeper) {
    targetsById.set(defendingKeeper.playerId, {
      xM: flag.xM + defendDirection * 2.1,
      yM: setup.pitch.widthM / 2 +
        (flag.yM === 0 ? -1.2 : 1.2),
    })
  }
  if (cb1) targetsById.set(cb1.playerId, {
    xM: flag.xM + defendDirection * 6,
    yM: targets.near.yM,
  })
  if (cb2) targetsById.set(cb2.playerId, {
    xM: flag.xM + defendDirection * 7.6,
    yM: targets.far.yM,
  })

  const players = state.players.map(p => {
    const teamIndex = state.teams.findIndex(t => t.clubId === p.clubId)
    if (teamIndex < 0 || !state.ai.enabledTeams[teamIndex]) return p
    const preferred = targetsById.get(p.playerId) ?? p.position
    const point = p.clubId === awarded ? preferred :
      cornerOpponentRetreatTarget(preferred, event, setup.pitch)
    const previous = p.intention
    const same = previous.kind === 'moveToPoint' &&
      distance(previous.target, point) < .16
    return {
      ...p, engagesBall: false,
      intention: same ? previous : {
        kind: 'moveToPoint' as const,
        sinceTick: state.clock.tick,
        target: { ...point },
      },
    }
  })
  let staged: MatchState = {
    ...state, players,
    ai: { ...state.ai, decisionSnapshot: [] },
  }
  const takerReady = distance(taker.position, spot) <= 1.03 &&
    Math.hypot(taker.velocity.xMps, taker.velocity.yMps) <= 1.8
  const attackReady = distance(near.position, targets.near) < 3.0 ||
    distance(far.position, targets.far) < 3.0
  const shortReady = distance(short.position, targets.short) < 2.4
  const clear = cornerOpponentsClear(state, event, setup.pitch)
  const pending = state.pendingCommands.some(c => c.type === 'attemptCornerKick')
  const prior = [...state.appliedCommands].reverse().find(c =>
    c.type === 'attemptCornerKick' && c.teamId === awarded &&
    c.appliedTick > event.tick)
  const outcome = prior && state.contactEvents.find(e =>
    e.commandId === prior.commandId)
  const canRetry = !prior || (
    outcome?.outcome !== 'cornerKicked' &&
    state.clock.tick - prior.appliedTick >= 8)
  if (!takerReady || !clear || !canRetry || pending ||
      state.clock.tick - event.tick < 14 ||
      (!attackReady && !shortReady)) return staged

  const def = setup.players.find(p => p.id === taker.playerId)!
  const skill = def.abilities.technical
  const cornerQuality = (.50 * skill.corners + .35 * skill.crossing +
    .15 * skill.technique) / 100
  const congestion = nearbyOpponents(state, awarded, targets.near, 3.2)
  const shortSpace = nearbyOpponents(state, awarded, short.position, 4.3)
  const takeShort = shortReady && (cornerQuality < .45 || congestion >= 3) &&
    shortSpace <= 1
  const receiver = takeShort ? short :
    distance(near.position, targets.near) <=
      distance(far.position, targets.far) ? near : far
  const target = { ...receiver.position }
  const d = distance(spot, target)
  // Speed/loft are estimates for this physical ball model, not a guaranteed
  // pass. Full heading/air-duel competition remains a separate S3 feature.
  const power = takeShort ? clamp(d / 40, .25, .62) :
    clamp(d / 45, .45, .93)
  const lift = takeShort ? .02 : .78
  const commandId = 'ai-pass-corner-' + event.tick +
    '-' + state.nextCommandSequence
  const receipt = scheduleMatchCommand(staged, {
    commandId, type: 'attemptCornerKick',
    teamId: awarded, playerId: taker.playerId, target, power, lift,
  }, setup.pitch)
  if (!receipt.receipt.accepted)
    throw new Error('Cannot schedule physical corner: ' + receipt.receipt.reason)
  staged = {
    ...receipt.state,
    ai: {
      ...receipt.state.ai,
      lastPassTick: state.clock.tick,
      passIntent: {
        commandId, teamId: awarded,
        passerId: taker.playerId,
        receiverId: receiver.playerId,
        requestedTick: state.clock.tick,
        target,
      },
    },
  }
  return staged
}

export function advanceCornerStoppage(
  state: MatchState, setup: MatchSetup,
  resolveContact: (state: MatchState, setup: MatchSetup) => MatchState,
): MatchState {
  const staged = stageCorner(state, setup)
  const moved = advancePlayerLocomotion(staged, setup.players, setup.pitch)
  const contacted = resolveContact(moved, setup)
  if (!contacted.contactEvents.some(e =>
    e.tick === contacted.clock.tick &&
    e.kind === 'cornerKick' && e.outcome === 'cornerKicked')) return contacted
  return { ...contacted, restart: null }
}
