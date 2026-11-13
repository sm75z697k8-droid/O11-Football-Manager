import { createRandomStream, restoreRandomStream } from '../core/rng'
import { BALL_RADIUS_M, isBallFullyOutsidePitch } from './ball'
import { GOALKEEPER_HAND_HEIGHT_M, GOALKEEPER_HOLD_MIN_TICKS, activeGoalkeeperCatch, goalkeeperThrowVelocity } from './goalkeeper-handling'
import type { MatchSetup } from '../model/match'
import type { PlayerDefinition } from '../model/player'
import type { PitchDefinition, Point2 } from '../model/pitch'
import type { PlayerMatchState, BallMatchState, MatchState, ContactEvent } from '../match/state'
import type { AppliedMatchCommand } from '../match/commands'
import { throwInTakerTarget, forbiddenRestartSecondTouch } from '../match/restarts'
import { offsideKickPrefix, offsideKickStationary, offsideOpponentsClear } from '../match/offside'
import { goalKickSpot, insideRestartPenaltyArea } from '../match/goal-kicks'
import {
  cornerBallSpot, cornerOpponentsClear, selectCornerTaker,
} from '../match/corners'
import {
  postGoalKickoffPlayersLegal, postGoalKickoffBallStationary,
  postGoalKickoffCommandPrefix,
} from '../match/post-goal-kickoff'
import {
  periodKickoffPrefix, secondHalfKickoffLegal,
  secondHalfKickoffBallStationary,
} from '../match/periods'

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
 * Phase 6.9N — deterministic close-control geometry (design estimates).
 * A controlled ball stays within genuine foot reach, but its local offset
 * smoothly follows the carrier's facing, real momentum and speed. Unlike the
 * previous immutable receiving offset, it cannot remain permanently behind
 * a dribbler who has turned.
 *
 * This is a conservative first step, NOT free-ball touches or random
 * dribbling-loss rolls. Defenders still win only physical contacts.
 */
export const CLOSE_CONTROL_VERSION = 'directional-foot-carry-p69n-v1'
export const CLOSE_CONTROL_STEP_SECONDS = .05
export const CLOSE_CONTROL_MAX_OFFSET_M = .75
const closeClamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

export function closeControlOffset(
  ball: BallMatchState, player: PlayerMatchState,
  definition: PlayerDefinition, pitch: PitchDefinition,
): Point2 {
  if (definition.id !== player.playerId) {
    throw new Error('Close control requires the owning player definition')
  }
  if (!ball.controlOffset || ball.controllerId !== player.playerId) {
    throw new Error('Close control requires genuine foot possession')
  }
  const abilities = definition.abilities
  const skill = closeClamp((
    .35 * abilities.technical.dribbling +
    .20 * abilities.technical.firstTouch +
    .20 * abilities.physical.agility +
    .15 * abilities.physical.balance +
    .10 * abilities.mental.composure) / 100, 0, 1)
  const speed = Math.hypot(player.velocity.xMps, player.velocity.yMps)
  const forwardX = Math.cos(player.orientationRad)
  const forwardY = Math.sin(player.orientationRad)
  // During a sharp turn the player's facing changes before their momentum.
  // An intermediate bearing puts the ball near the feet instead of
  // snapping it immediately to the wrong side of their movement.
  const momentumWeight = .3 * closeClamp(speed / 4, 0, 1)
  const mx = speed > 1e-6 ? player.velocity.xMps / speed : forwardX
  const my = speed > 1e-6 ? player.velocity.yMps / speed : forwardY
  const blendedX = (1 - momentumWeight) * forwardX + momentumWeight * mx
  const blendedY = (1 - momentumWeight) * forwardY + momentumWeight * my
  const bearingLength = Math.hypot(blendedX, blendedY)
  const dx = blendedX / Math.max(bearingLength, 1e-6)
  const dy = blendedY / Math.max(bearingLength, 1e-6)
  // Faster carries take a slightly longer touch; better ball control keeps
  // that touch closer. Never exceed the 1.05m legal foot-reach envelope.
  const desiredRadius = .41 +
    .30 * closeClamp(speed / 8.5, 0, 1) * (1.10 - .20 * skill)
  const desired = { xM: dx * desiredRadius, yM: dy * desiredRadius }
  const previous = ball.controlOffset
  const gapX = desired.xM - previous.xM
  const gapY = desired.yM - previous.yM
  const gap = Math.hypot(gapX, gapY)
  // Every 50ms tick can advance the contact point only a small physical
  // distance. Higher dribbling/first-touch/agility improves responsiveness.
  const stepM = (2.1 + 2.3 * skill + .10 * speed) *
    CLOSE_CONTROL_STEP_SECONDS
  const fraction = gap > stepM ? stepM / gap : 1
  const movedX = previous.xM + gapX * fraction
  const movedY = previous.yM + gapY * fraction
  const magnitude = Math.hypot(movedX, movedY)
  const bound = magnitude > CLOSE_CONTROL_MAX_OFFSET_M
    ? CLOSE_CONTROL_MAX_OFFSET_M / magnitude : 1
  // Keep the genuine controlled ball on the playing surface even if a
  // carrier turns right against the pitch boundary. A later free kick can
  // still legitimately travel out; this is only active during possession.
  const proposedX = player.position.xM + movedX * bound
  const proposedY = player.position.yM + movedY * bound
  const x = closeClamp(proposedX, BALL_RADIUS_M,
    pitch.lengthM - BALL_RADIUS_M)
  const y = closeClamp(proposedY, BALL_RADIUS_M,
    pitch.widthM - BALL_RADIUS_M)
  return { xM: x - player.position.xM, yM: y - player.position.yM }
}

/** Advance the actual physical owner and its attached ball as one coherent
 * 50ms contact state. Hand-held GK catches remain unchanged. The optional
 * definition preserves the historical diagnostic API for direct unit callers;
 * the authoritative match runner always supplies it for football dribblers.
 */
export function advanceControlledBall(
  ball: BallMatchState, player: PlayerMatchState, pitch: PitchDefinition,
  definition?: PlayerDefinition,
): BallMatchState {
  if (ball.controllerId !== player.playerId || !ball.controlOffset) {
    throw new Error('Controlled ball must have a valid player and relative offset')
  }
  const offset = definition && ball.heightM !== GOALKEEPER_HAND_HEIGHT_M
    ? closeControlOffset(ball, player, definition, pitch)
    : ball.controlOffset
  const position: Point2 = {
    xM: player.position.xM + offset.xM,
    yM: player.position.yM + offset.yM,
  }
  return {
    ...ball, controlOffset: offset,
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
  command: AppliedMatchCommand, kind: ContactEvent['kind'],
  outcome: ContactEvent['outcome'], drawUsed: 0 | 1,
): ContactEvent {
  if (command.type !== 'attemptFirstTouch' && command.type !== 'attemptKick' &&
      command.type !== 'attemptGoalkeeperThrow' &&
      command.type !== 'attemptThrowIn' &&
      command.type !== 'attemptGoalKick' &&
      command.type !== 'attemptCornerKick') {
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
      command.type === 'attemptGoalkeeperThrow' ||
      command.type === 'attemptThrowIn' ||
      command.type === 'attemptGoalKick' ||
      command.type === 'attemptCornerKick'),
  )
  if (!commands.length) return state

  const players = new Map(state.players.map((player) => [player.playerId, player]))
  const definitions = new Map(setup.players.map((player) => [player.id, player]))
  let ball = state.ball
  let contactRng = restoreRandomStream(state.randomStreams['ball/contact'])
  const events: ContactEvent[] = []
  for (const command of commands) {
    if (command.type !== 'attemptFirstTouch' && command.type !== 'attemptKick' &&
        command.type !== 'attemptGoalkeeperThrow' &&
        command.type !== 'attemptThrowIn' &&
        command.type !== 'attemptGoalKick' &&
        command.type !== 'attemptCornerKick') continue
    const kind = command.type === 'attemptFirstTouch' ? 'control' :
      command.type === 'attemptGoalkeeperThrow' ? 'throw' :
        command.type === 'attemptThrowIn' ? 'throwIn' :
          command.type === 'attemptGoalKick' ? 'goalKick' :
            command.type === 'attemptCornerKick' ? 'cornerKick' : 'kick'
    const player = players.get(command.playerId)
    const definition = definitions.get(command.playerId)
    if (!player || !definition) throw new Error('Applied contact references an unknown player')

    if (ball.controllerId && ball.controllerId !== command.playerId) {
      events.push(event(command, kind, 'occupied', 0))
      continue
    }
    if (state.offsideRestart) {
      const free=state.offsideRestart
      const authorized=command.type==='attemptKick' &&
        command.commandId.startsWith(offsideKickPrefix(free.tick)) &&
        command.teamId===free.awardedTeamId &&
        command.playerId===free.takerId &&
        state.clock.tick-free.tick>=14 &&
        offsideKickStationary({...state,ball}) &&
        offsideOpponentsClear(state,setup)
      if (!authorized) {
        events.push(event(command,kind,'notReady',0))
        continue
      }
    }
    if (state.periodKickoff) {
      const half = state.periodKickoff
      const authorized = command.type === 'attemptKick' &&
        half.phase === 'staging' &&
        command.commandId.startsWith(periodKickoffPrefix(half.startTick)) &&
        command.playerId === half.kickerId &&
        command.teamId === half.teamId &&
        secondHalfKickoffLegal(state, setup) &&
        secondHalfKickoffBallStationary({...state, ball}, setup)
      if (!authorized) {
        events.push(event(command, kind, 'notReady', 0))
        continue
      }
    }
    if (state.postGoalKickoff) {
      const restart = state.postGoalKickoff
      const authorized = command.type === 'attemptKick' &&
        restart.phase === 'staging' &&
        command.commandId.startsWith(
          postGoalKickoffCommandPrefix(restart.goalTick)) &&
        command.playerId === restart.kickerId &&
        command.teamId === restart.teamId &&
        state.clock.tick - restart.goalTick >= 22 &&
        postGoalKickoffBallStationary({ ...state, ball }, setup) &&
        postGoalKickoffPlayersLegal(state, setup, restart)
      if (!authorized) {
        events.push(event(command, kind, 'notReady', 0))
        continue
      }
    }
    if (command.type === 'attemptThrowIn') {
      const restart = state.restart
      const at = restart?.kind === 'throwIn'
        ? throwInTakerTarget(restart, setup) : null
      const legal = !!restart && restart.kind === 'throwIn' &&
        restart.takerId === player.playerId &&
        restart.awardedTeamId === player.clubId &&
        at !== null && ball.outsidePitch &&
        Math.hypot(player.position.xM - at.xM,
          player.position.yM - at.yM) <= 1.15 &&
        state.clock.tick - restart.tick >= 14
      if (!legal || !at) {
        events.push(event(command, kind, 'notReady', 0))
        continue
      }
      const dx = command.target.xM - restart.spot.xM
      const dy = command.target.yM - restart.spot.yM
      const distance = Math.hypot(dx, dy)
      if (distance < 2.5 || distance > 28) {
        events.push(event(command, kind, 'invalidDirection', 0))
        continue
      }
      const a = definition.abilities
      const quality = (
        .5 * a.technical.longThrows +
        .3 * a.technical.technique +
        .2 * a.mental.composure) / 100
      const spread = .014 + (1 - quality) * .10
      const error = (contactRng.nextFloat() - .5) * 2 * spread
      const nominalAngle = Math.atan2(dy, dx)
      const bearing = nominalAngle + error
      const launchHeight = 1.85
      const verticalSpeed = 2.9 + command.power * 2.2
      // Aim the physical flight at a plausible receiving distance, not
      // at a fixed 20m launch that flies past a short 8–12m outlet.
      // Exact flight is still simulated by ball physics after release.
      const flightTime = (verticalSpeed + Math.sqrt(
        verticalSpeed * verticalSpeed +
          2 * 9.81 * (launchHeight - BALL_RADIUS_M))) / 9.81
      const idealPlanar = (Math.exp(.008 * distance) - 1) /
        (.008 * flightTime)
      const planarSpeed = Math.min(25, idealPlanar *
        (.80 + .34 * command.power) *
        (.97 + a.physical.strength * .0006))
      const position = { ...restart.spot }
      ball = {
        ...ball, position,
        heightM: launchHeight,
        velocity: {
          xMps: Math.cos(bearing) * planarSpeed,
          yMps: Math.sin(bearing) * planarSpeed,
          zMps: verticalSpeed,
        },
        controllerId: null, controlOffset: null,
        lastTouchPlayerId: player.playerId, outsidePitch: false,
      }
      events.push(event(command, kind, 'thrownIn', 1))
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
      const spread = .015 + (1 - quality) * .12
      const angleError = (contactRng.nextFloat() - .5) * 2 * spread
      // The non-awarding preview and this REAL release share the same
      // nominal throw model; only actual contact consumes a seeded error.
      ball = {
        ...ball,
        velocity: goalkeeperThrowVelocity(
          ball.position, command.target, command.power, angleError),
        controllerId: null, controlOffset: null,
        lastTouchPlayerId: player.playerId,
      }
      events.push(event(command, kind, 'thrown', 1))
      continue
    }
    if (command.type === 'attemptCornerKick') {
      const restart = state.restart
      const placement = restart?.kind === 'corner'
        ? cornerBallSpot(restart, setup.pitch) : null
      const selected = restart?.kind === 'corner'
        ? selectCornerTaker(state, restart, setup) : null
      const legal = restart?.kind === 'corner' && !!placement &&
        restart.awardedTeamId === player.clubId &&
        selected?.playerId === player.playerId &&
        state.clock.tick - restart.tick >= 14 &&
        !ball.outsidePitch && ball.controllerId === null &&
        ball.heightM === BALL_RADIUS_M &&
        ball.velocity.xMps === 0 && ball.velocity.yMps === 0 &&
        ball.velocity.zMps === 0 &&
        Math.hypot(ball.position.xM - placement.xM,
          ball.position.yM - placement.yM) <= 1e-7 &&
        canReachBall(player, ball) &&
        cornerOpponentsClear(state, restart, setup.pitch)
      if (!legal) {
        events.push(event(command, kind, 'notReady', 0))
        continue
      }
    }
    if (command.type === 'attemptGoalKick') {
      const awarded = state.restart
      const place = awarded?.kind === 'goalKick'
        ? goalKickSpot(awarded, setup.pitch) : null
      const opponentsClear = awarded && state.players.every(p =>
        p.clubId === awarded.awardedTeamId ||
        !insideRestartPenaltyArea(p.position, awarded, setup.pitch))
      const legal = awarded?.kind === 'goalKick' && !!place &&
        awarded.awardedTeamId === player.clubId &&
        player.formationSlot === 'GK' &&
        !!definition.abilities.goalkeeping &&
        state.clock.tick - awarded.tick >= 14 &&
        !ball.outsidePitch && ball.controllerId === null &&
        ball.heightM === BALL_RADIUS_M &&
        ball.velocity.xMps === 0 && ball.velocity.yMps === 0 &&
        ball.velocity.zMps === 0 &&
        Math.hypot(ball.position.xM - place.xM,
          ball.position.yM - place.yM) < 1e-7 &&
        Math.hypot(player.position.xM - ball.position.xM,
          player.position.yM - ball.position.yM) <= FOOT_REACH_M &&
        !!opponentsClear
      if (!legal) {
        events.push(event(command, kind, 'notReady', 0))
        continue
      }
    }
    if (forbiddenRestartSecondTouch({ ...state, ball }, player.playerId)) {
      events.push(event(command, kind, 'secondTouch', 0))
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
    const baseAccuracy = contactAccuracy(definition, shooting)
    const accuracy = command.type === 'attemptGoalKick' &&
      a.goalkeeping ? (.52 * a.goalkeeping.kickingDistribution +
        .29 * a.technical.passing + .19 * a.mental.composure) / 100 :
      command.type === 'attemptCornerKick'
        ? (.52 * a.technical.corners + .30 * a.technical.crossing +
          .18 * a.mental.composure) / 100 :
      baseAccuracy
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
    events.push(event(command, kind,
      command.type === 'attemptGoalKick' ? 'goalKicked' :
        command.type === 'attemptCornerKick' ? 'cornerKicked' :
          'kicked', 1))
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
