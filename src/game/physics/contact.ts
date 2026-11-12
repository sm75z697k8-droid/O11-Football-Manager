import { createRandomStream, restoreRandomStream } from '../core/rng'
import { BALL_RADIUS_M, isBallFullyOutsidePitch } from './ball'
import { GOALKEEPER_HAND_HEIGHT_M, GOALKEEPER_HOLD_MIN_TICKS, activeGoalkeeperCatch } from './goalkeeper-handling'
import type { MatchSetup } from '../model/match'
import type { PlayerDefinition } from '../model/player'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { PlayerMatchState, BallMatchState, MatchState, ContactEvent } from '../match/state'
import type { AppliedMatchCommand } from '../match/commands'

/**
 * Contact tests are intentionally explicit in Phase 3: no football AI is
 * selecting actions, and proximity alone must not invent a pass or goal.
 * Geometry and attributes dominate; a small seeded variation influences
 * execution quality. Constants are SIMULATION ESTIMATES, not measured data.
 */
export const CONTACT_PHYSICS_VERSION = 'player-ball-contact-v1' as const
/** Use the same skill blend in the pass planner and actual kick. */
export function contactAccuracy(definition: PlayerDefinition, shooting: boolean): number {
  const a = definition.abilities
  return shooting ? (
    .50 * a.technical.finishing + .20 * a.technical.longShots +
    .20 * a.technical.technique + .10 * a.mental.composure
  ) / 100 : (
    .50 * a.technical.passing + .30 * a.technical.technique +
    .20 * a.mental.composure
  ) / 100
}

/** AI ground passes have a smaller, skill-dependent angular spread than the
 * old diagnostic kicks. Bad body orientation still hurts precision.
 * The angular roll remains seeded, and physical contacts still decide the
 * result; there is NO artificial pass completion or trajectory snapping.
 */
export function kickAngleErrorRange(
  accuracy: number, facingError: number, aiPass: boolean, shooting: boolean,
): number {
  if (aiPass && !shooting) {
    return .008 + (1 - accuracy) * .10 + facingError * .045
  }
  return .025 + (1 - accuracy) * .26 + facingError * .12
}

export const FOOT_REACH_M = 1.05
export const FOOT_CONTACT_MAX_HEIGHT_M = BALL_RADIUS_M + 0.34

export function contactDistance(player: PlayerMatchState, ball: BallMatchState): number {
  return Math.hypot(
    player.position.xM - ball.position.xM,
    player.position.yM - ball.position.yM,
  )
}

export function canReachBall(player: PlayerMatchState, ball: BallMatchState): boolean {
  return player.participation === 'onField' && !ball.outsidePitch &&
    ball.heightM <= FOOT_CONTACT_MAX_HEIGHT_M &&
    contactDistance(player, ball) <= FOOT_REACH_M
}

/**
 * During controlled possession the ball follows its relative foot position,
 * rather than having a cosmetic player sprite carry an unrelated ball.
 * This is a simplified local-control constraint, not a dribbling simulator.
 */
export function advanceControlledBall(
  ball: BallMatchState, player: PlayerMatchState, pitch: PitchDefinition,
): BallMatchState {
  if (ball.controllerId !== player.playerId || !ball.controlOffset) {
    throw new Error('Controlled ball must have a valid player and relative offset')
  }
  const position: Point2 = {
    xM: player.position.xM + ball.controlOffset.xM,
    yM: player.position.yM + ball.controlOffset.yM,
  }
  return {
    ...ball,
    position,
    heightM: ball.heightM === GOALKEEPER_HAND_HEIGHT_M
      ? GOALKEEPER_HAND_HEIGHT_M : BALL_RADIUS_M,
    velocity: {
      xMps: player.velocity.xMps,
      yMps: player.velocity.yMps,
      zMps: 0,
    },
    outsidePitch: isBallFullyOutsidePitch(position.xM, position.yM, pitch),
  }
}

function event(
  command: AppliedMatchCommand, kind: 'control' | 'kick' | 'throw',
  outcome: ContactEvent['outcome'], drawUsed: 0 | 1,
): ContactEvent {
  if (command.type !== 'attemptFirstTouch' && command.type !== 'attemptKick' &&
      command.type !== 'attemptGoalkeeperThrow') {
    throw new Error('Unexpected command supplied to contact resolver')
  }
  return {
    commandId: command.commandId,
    playerId: command.playerId,
    tick: command.appliedTick,
    kind, outcome, drawUsed,
  }
}

/**
 * Consume each contact attempt once, AFTER the tick's player+ball movement.
 * Same-tick attempts run in the committed command sequence.
 */
export function resolveContactAttempts(
  state: MatchState, setup: MatchSetup,
): MatchState {
  const last = state.appliedCommands[state.appliedCommands.length - 1]
  if (!last || last.appliedTick !== state.clock.tick) return state

  const commands = state.appliedCommands.filter((command) =>
    command.appliedTick === state.clock.tick &&
    (command.type === 'attemptFirstTouch' || command.type === 'attemptKick' ||
      command.type === 'attemptGoalkeeperThrow'),
  )
  if (!commands.length) return state

  const players = new Map(state.players.map((player) => [player.playerId, player]))
  const definitions = new Map(setup.players.map((player) => [player.id, player]))
  let ball = state.ball
  let contactRng = restoreRandomStream(state.randomStreams['ball/contact'])
  const events: ContactEvent[] = []
  for (const command of commands) {
    if (command.type !== 'attemptFirstTouch' && command.type !== 'attemptKick' &&
        command.type !== 'attemptGoalkeeperThrow') continue
    const kind = command.type === 'attemptFirstTouch' ? 'control' :
      command.type === 'attemptGoalkeeperThrow' ? 'throw' : 'kick'
    const player = players.get(command.playerId)
    const definition = definitions.get(command.playerId)
    if (!player || !definition) throw new Error('Applied contact references an unknown player')

    if (ball.controllerId && ball.controllerId !== command.playerId) {
      events.push(event(command, kind, 'occupied', 0))
      continue
    }
    if (command.type === 'attemptGoalkeeperThrow') {
      const catchEvent = activeGoalkeeperCatch({...state, ball})
      if (ball.controllerId !== player.playerId ||
          player.formationSlot !== 'GK' || !catchEvent) {
        events.push(event(command, kind, 'notHolding', 0))
        continue
      }
      if (state.clock.tick - catchEvent.tick < GOALKEEPER_HOLD_MIN_TICKS) {
        events.push(event(command, kind, 'tooSoon', 0))
        continue
      }
      const dx = command.target.xM - ball.position.xM
      const dy = command.target.yM - ball.position.yM
      if (Math.hypot(dx, dy) < .05) {
        events.push(event(command, kind, 'invalidDirection', 0))
        continue
      }
      const a = definition.abilities
      if (!a.goalkeeping) throw new Error('Only a goalkeeper can throw from hands')
      const quality = (
        .6 * a.goalkeeping.throwingDistribution +
        .25 * a.technical.technique + .15 * a.mental.composure) / 100
      const heading = Math.atan2(dy, dx)
      const spread = .015 + (1 - quality) * .12
      const angle = heading + (contactRng.nextFloat() - .5) * 2 * spread
      // A release at hand height follows real airborne ball physics;
      // success still depends on a teammate's physical first touch.
      const speed = 4.8 + command.power * 9.3
      ball = {
        ...ball,
        velocity: {
          xMps: Math.cos(angle) * speed,
          yMps: Math.sin(angle) * speed,
          zMps: .4 + command.power * 1.2,
        },
        controllerId: null, controlOffset: null,
        lastTouchPlayerId: player.playerId,
      }
      events.push(event(command, kind, 'thrown', 1))
      continue
    }
    if (!canReachBall(player, ball)) {
      events.push(event(command, kind, 'outOfReach', 0))
      continue
    }
    if (kind === 'control' && ball.controllerId === player.playerId) {
      events.push(event(command, kind, 'alreadyControlled', 0))
      continue
    }

    if (command.type === 'attemptFirstTouch') {
      const a = definition.abilities
      const quality =
        0.40 * a.technical.firstTouch + 0.25 * a.technical.technique +
        0.20 * a.physical.balance + 0.15 * a.mental.composure
      const relativeSpeed = Math.hypot(
        ball.velocity.xMps - player.velocity.xMps,
        ball.velocity.yMps - player.velocity.yMps,
      )
      const verticalSpeed = Math.abs(ball.velocity.zMps)
      const distance = contactDistance(player, ball)
      const difficulty = 2.0 * relativeSpeed + 0.7 * verticalSpeed +
        11 * distance / FOOT_REACH_M +
        14 * (ball.heightM - BALL_RADIUS_M) /
          (FOOT_CONTACT_MAX_HEIGHT_M - BALL_RADIUS_M)
      const variation = (contactRng.nextFloat() - 0.5) * 12
      const controlled = quality - difficulty + variation >= 30
      if (controlled) {
        ball = {
          ...ball,
          heightM: BALL_RADIUS_M,
          velocity: {
            xMps: player.velocity.xMps,
            yMps: player.velocity.yMps,
            zMps: 0,
          },
          controllerId: player.playerId,
          controlOffset: {
            xM: ball.position.xM - player.position.xM,
            yM: ball.position.yM - player.position.yM,
          },
          lastTouchPlayerId: player.playerId,
        }
        events.push(event(command, kind, 'controlled', 1))
      } else {
        // The touch physically deflects the ball; it is not claimed as possession.
        const rebound = 0.35 + 0.20 * (1 - quality / 100)
        ball = {
          ...ball,
          velocity: {
            xMps: ball.velocity.xMps * rebound + player.velocity.xMps * 0.40 +
              Math.cos(player.orientationRad) * 0.7,
            yMps: ball.velocity.yMps * rebound + player.velocity.yMps * 0.40 +
              Math.sin(player.orientationRad) * 0.7,
            zMps: Math.max(0, ball.velocity.zMps) * 0.25,
          },
          controllerId: null,
          controlOffset: null,
          lastTouchPlayerId: player.playerId,
        }
        events.push(event(command, kind, 'miscontrolled', 1))
      }
      continue
    }

    const dx = command.target.xM - ball.position.xM
    const dy = command.target.yM - ball.position.yM
    if (Math.hypot(dx, dy) < 0.05) {
      events.push(event(command, kind, 'invalidDirection', 0))
      continue
    }
    const a = definition.abilities
    const shooting = command.commandId.startsWith('ai-shot-')
    const accuracy = contactAccuracy(definition, shooting)
    const heading = Math.atan2(dy, dx)
    const facingError = Math.abs(Math.atan2(
      Math.sin(heading - player.orientationRad),
      Math.cos(heading - player.orientationRad),
    )) / Math.PI
    const errorRange = kickAngleErrorRange(accuracy, facingError,
      command.commandId.startsWith('ai-pass-'), shooting)
    const angle = heading + (contactRng.nextFloat() - 0.5) * 2 * errorRange
    const strength = a.physical.strength
    const speed = Math.min(38,
      (3 + command.power * (14 + 0.13 * strength +
        0.065 * a.technical.technique)) * (0.9 + 0.1 * accuracy),
    )
    const verticalFraction = 0.6 * command.lift
    const zMps = speed * verticalFraction
    const planarSpeed = speed * Math.sqrt(1 - verticalFraction * verticalFraction)
    ball = {
      ...ball,
      velocity: {
        xMps: planarSpeed * Math.cos(angle),
        yMps: planarSpeed * Math.sin(angle),
        zMps,
      },
      controllerId: null,
      controlOffset: null,
      lastTouchPlayerId: player.playerId,
    }
    events.push(event(command, kind, 'kicked', 1))
  }

  const randomStreams = events.some((entry) => entry.drawUsed)
    ? { ...state.randomStreams, 'ball/contact': contactRng.checkpoint() }
    : state.randomStreams
  return {
    ...state,
    ball,
    randomStreams,
    contactEvents: [...state.contactEvents, ...events],
  }
}

/** Reconstruct the exact expected stream state from a count of contact draws. */
export function expectedContactStream(masterSeed: number, draws: number) {
  const stream = createRandomStream(masterSeed, 'ball/contact')
  for (let i = 0; i < draws; i += 1) stream.nextUint32()
  return stream.checkpoint()
}
