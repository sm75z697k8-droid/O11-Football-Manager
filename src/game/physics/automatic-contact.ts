
import { BALL_RADIUS_M, isBallFullyOutsidePitch } from './ball'
import { FOOT_CONTACT_MAX_HEIGHT_M, FOOT_REACH_M } from './contact'
import type { MatchState, BallMatchState, PlayerMatchState, AutomaticContactEvent } from '../match/state'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import { activePhysicalShot } from '../ai/goal-directed'

/**
 * Phase 4 — physical detection when an agent has declared intent to contest.
 * No strategy/AI chooses whom to engage. All values below are estimated,
 * deterministic mechanics; there is no hidden outcome generator.
 */
export const AUTOMATIC_CONTACT_VERSION = 'swept-engagement-v1' as const
export const AUTO_CONTACT_COOLDOWN_TICKS = 6
export const AUTO_BALL_FOOT_OFFSET_M = 0.82

interface ContactSample {
  readonly fraction: number
  readonly distanceM: number
  readonly impact: Point2
}
interface Candidate {
  readonly player: PlayerMatchState
  readonly sample: ContactSample
}

/**
 * Min-distance time on the common [0,1] motion interval with a height gate.
 * Relative segment (ball-oldPlayer) -> (ball-newPlayer) supports fast balls,
 * moving footballers, and high airborne trajectories without endpoint-only
 * tunnelling. Ball height uses a linear within-tick approximation.
 */
export function sweptFootContact(
  playerBefore: PlayerMatchState,
  playerAfter: PlayerMatchState,
  ballBefore: BallMatchState,
  ballAfter: BallMatchState,
  reachM = FOOT_REACH_M,
  maxHeightM = FOOT_CONTACT_MAX_HEIGHT_M,
): ContactSample | null {
  const x0 = ballBefore.position.xM - playerBefore.position.xM
  const y0 = ballBefore.position.yM - playerBefore.position.yM
  const rx = (ballAfter.position.xM - ballBefore.position.xM) -
    (playerAfter.position.xM - playerBefore.position.xM)
  const ry = (ballAfter.position.yM - ballBefore.position.yM) -
    (playerAfter.position.yM - playerBefore.position.yM)
  let lo = 0
  let hi = 1
  const h0 = ballBefore.heightM
  const dh = ballAfter.heightM - h0
  if (h0 > maxHeightM &&
      ballAfter.heightM > maxHeightM) return null
  if (dh > 0 && h0 > maxHeightM) return null
  if (dh < 0 && ballAfter.heightM > maxHeightM) return null
  if (dh > 0) hi = Math.min(hi, (maxHeightM - h0) / dh)
  if (dh < 0) lo = Math.max(lo, (maxHeightM - h0) / dh)
  lo = Math.max(0, lo)
  hi = Math.min(1, hi)
  if (lo > hi) return null

  const dd = rx * rx + ry * ry
  const closest = dd > 1e-12 ? -(x0 * rx + y0 * ry) / dd : lo
  const nearest = Math.min(hi, Math.max(lo, closest))
  const minDistance = Math.hypot(x0 + nearest * rx, y0 + nearest * ry)
  if (minDistance > reachM) return null

  // Earliest entry into the reachable radius, not merely closest approach.
  // This ensures simultaneous candidates are sorted by physical impact time.
  const b = 2 * (x0 * rx + y0 * ry)
  const c = x0 * x0 + y0 * y0 - reachM * reachM
  const disc = Math.max(0, b * b - 4 * dd * c)
  const entry = dd > 1e-12 ? (-b - Math.sqrt(disc)) / (2 * dd) : lo
  const fraction = Math.max(lo, Math.min(nearest, entry))
  const dist = Math.hypot(x0 + fraction * rx, y0 + fraction * ry)

  const impact = {
    xM: ballBefore.position.xM +
      fraction * (ballAfter.position.xM - ballBefore.position.xM),
    yM: ballBefore.position.yM +
      fraction * (ballAfter.position.yM - ballBefore.position.yM),
  }
  return { fraction, distanceM: dist, impact }
}

function attachTo(
  ball: BallMatchState, player: PlayerMatchState, impact: Point2,
  pitch: MatchSetup['pitch'],
): BallMatchState {
  const dx = impact.xM - player.position.xM
  const dy = impact.yM - player.position.yM
  const d = Math.hypot(dx, dy)
  const scale = d > AUTO_BALL_FOOT_OFFSET_M ? AUTO_BALL_FOOT_OFFSET_M / d : 1
  const offset = { xM: dx * scale, yM: dy * scale }
  const position = {
    xM: player.position.xM + offset.xM,
    yM: player.position.yM + offset.yM,
  }
  return {
    ...ball, position, heightM: BALL_RADIUS_M,
    velocity: { ...player.velocity, zMps: 0 },
    controllerId: player.playerId, controlOffset: offset,
    lastTouchPlayerId: player.playerId,
    outsidePitch: isBallFullyOutsidePitch(position.xM, position.yM, pitch),
  }
}

function candidate(
  before: MatchState, after: MatchState, owner: PlayerMatchState | undefined,
): Candidate | null {
  const pastPlayers = new Map(before.players.map(p => [p.playerId, p]))
  const options: Candidate[] = []
  const shot = activePhysicalShot(after)
  const shooter = shot && after.players.find(p => p.playerId === shot.shooterId)
  for (const p of after.players) {
    // A kick-off taker may not touch the ball again until another player
    // touches it; skip the taker during this protected opening passage.
    if (after.kickoff?.phase === 'inPlay' &&
        before.ball.lastTouchPlayerId === after.kickoff.kickerId &&
        p.playerId === after.kickoff.kickerId) continue
    if (!p.engagesBall || p.participation !== 'onField' ||
      p.playerId === owner?.playerId ||
      (owner && p.clubId === owner.clubId)) continue
    const old = pastPlayers.get(p.playerId)
    if (!old) continue
    // Keepers use a modest aerial hand-reach envelope ONLY while responding
    // to a confirmed opposition shot. The sweep still checks real motion.
    const goalkeeperSave = p.formationSlot === 'GK' &&
      !!shooter && shooter.clubId !== p.clubId
    const result = sweptFootContact(old, p, before.ball, after.ball,
      goalkeeperSave ? 1.55 : FOOT_REACH_M,
      goalkeeperSave ? 2.17 : FOOT_CONTACT_MAX_HEIGHT_M)
    if (!result) continue
    options.push({ player: p, sample: result })
  }
  options.sort((a, b) =>
    a.sample.fraction - b.sample.fraction ||
    a.sample.distanceM - b.sample.distanceM ||
    (a.player.playerId < b.player.playerId ? -1 :
      a.player.playerId > b.player.playerId ? 1 : 0))
  return options[0] ?? null
}

/**
 * Maximum one automatic interaction per tick. The earliest swept contact
 * wins the arbitration, with stable ID tie-breaks; no dual ownership.
 */
export function resolveAutomaticBallContact(
  before: MatchState, after: MatchState, setup: MatchSetup,
): MatchState {
  const tick = after.clock.tick
  if (tick < after.ballContactCooldownUntilTick) return after
  // A diagnostic reset is an explicit test override, not a player's kick.
  if (after.appliedCommands.some(c =>
      c.appliedTick === tick && c.type === 'diagnosticBallLaunch')) return after
  // Phase 3 explicitly requested touch/kick has priority this tick, but an
  // unsuccessful or out-of-reach attempt does not suppress physical contact.
  if (after.contactEvents.some(e => e.tick === tick &&
      ['controlled', 'miscontrolled', 'kicked'].includes(e.outcome))) return after
  if (after.ball.outsidePitch && before.ball.outsidePitch) return after
  if (!after.players.some(p => p.engagesBall)) return after

  const owner = after.ball.controllerId
    ? after.players.find(p => p.playerId === after.ball.controllerId)
    : undefined
  const picked = candidate(before, after, owner)
  if (!picked) return after
  const { player, sample } = picked
  if (isBallFullyOutsidePitch(sample.impact.xM, sample.impact.yM, setup.pitch)) return after

  const definition = setup.players.find(d => d.id === player.playerId)
  if (!definition) throw new Error('Missing contender in authoritative match setup')
  let ball = after.ball
  let outcome: AutomaticContactEvent['outcome']
  let kind: AutomaticContactEvent['kind']
  if (owner) {
    kind = 'challenge'
    const ownerDef = setup.players.find(p => p.id === owner.playerId)
    if (!ownerDef) throw new Error('Missing ball owner definition')
    const challenge =
      0.40 * definition.abilities.technical.tackling +
      0.25 * definition.abilities.mental.anticipation +
      0.20 * definition.abilities.physical.strength +
      0.15 * definition.abilities.physical.balance
    const protection =
      0.40 * ownerDef.abilities.technical.dribbling +
      0.25 * ownerDef.abilities.physical.balance +
      0.20 * ownerDef.abilities.physical.strength +
      0.15 * ownerDef.abilities.mental.composure
    const approach = Math.hypot(player.velocity.xMps - owner.velocity.xMps,
      player.velocity.yMps - owner.velocity.yMps)
    if (challenge + Math.min(7, approach * 0.85) >= protection + 1.5) {
      ball = attachTo(ball, player, sample.impact, setup.pitch)
      outcome = 'wonChallenge'
    } else {
      outcome = 'heldOff'
    }
  } else {
    kind = 'interception'
    const keeperSave = player.formationSlot === 'GK' &&
      !!definition.abilities.goalkeeping && !!activePhysicalShot(after)
    const quality = keeperSave && definition.abilities.goalkeeping
      ? 0.45 * definition.abilities.goalkeeping.reflexes +
        0.35 * definition.abilities.goalkeeping.handling +
        0.20 * definition.abilities.goalkeeping.positioning
      : 0.50 * definition.abilities.technical.firstTouch +
        0.30 * definition.abilities.technical.technique +
        0.20 * definition.abilities.mental.anticipation
    const relativeSpeed = Math.hypot(
      before.ball.velocity.xMps - player.velocity.xMps,
      before.ball.velocity.yMps - player.velocity.yMps,
    )
    const challengeDifficulty = (keeperSave ? 1.12 : 1.6) * relativeSpeed +
      9 * sample.distanceM / (keeperSave ? 1.55 : FOOT_REACH_M)
    if (quality - challengeDifficulty >= (keeperSave ? 15 : 24)) {
      ball = attachTo(ball, player, sample.impact, setup.pitch)
      outcome = 'intercepted'
    } else {
      // Real collision impulse changes velocity at swept impact point.
      const dirX = sample.impact.xM - player.position.xM
      const dirY = sample.impact.yM - player.position.yM
      const d = Math.hypot(dirX, dirY)
      const nx = d > 1e-8 ? dirX / d : Math.cos(player.orientationRad)
      const ny = d > 1e-8 ? dirY / d : Math.sin(player.orientationRad)
      const horizontal = Math.hypot(ball.velocity.xMps, ball.velocity.yMps)
      const reboundSpeed = Math.min(18, 1.2 + 0.27 * horizontal)
      const position = { ...sample.impact }
      ball = {
        ...ball, position, heightM: Math.max(BALL_RADIUS_M,
          before.ball.heightM + sample.fraction *
            (after.ball.heightM - before.ball.heightM)),
        velocity: {
          xMps: player.velocity.xMps * 0.4 + nx * reboundSpeed,
          yMps: player.velocity.yMps * 0.4 + ny * reboundSpeed,
          zMps: Math.max(0, ball.velocity.zMps) * 0.35,
        },
        controllerId: null, controlOffset: null,
        lastTouchPlayerId: player.playerId,
        outsidePitch: isBallFullyOutsidePitch(position.xM, position.yM, setup.pitch),
      }
      outcome = 'deflected'
    }
  }

  const ev: AutomaticContactEvent = {
    tick, playerId: player.playerId, kind, outcome,
    contactFraction: sample.fraction,
  }
  return {
    ...after, ball,
    ballContactCooldownUntilTick: tick + AUTO_CONTACT_COOLDOWN_TICKS,
    automaticContactEvents: [...after.automaticContactEvents, ev],
  }
}
