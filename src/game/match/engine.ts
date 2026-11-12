import { advanceSimulationClock, MAX_SIMULATION_TICK, restoreSimulationClock } from '../core/clock'
import { restoreRandomStream } from '../core/rng'
import { runAutonomousDecisions } from '../ai/runner'
import { maintainPassReception } from '../ai/pass-coordination'
import { adjudicatePhysicalGoal } from './goals'
import {
  AUTO_CONTACT_COOLDOWN_TICKS, resolveAutomaticBallContact,
} from '../physics/automatic-contact'
import {
  advanceControlledBall, resolveContactAttempts,
  expectedContactStream, FOOT_REACH_M,
} from '../physics/contact'
import {
  BALL_RADIUS_M, MAX_LAUNCH_SPEED_MPS, isBallFullyOutsidePitch, advanceBallPhysics,
} from '../physics/ball'
import type { MatchSetup } from '../model/match'
import { deriveMotionLimits, advancePlayerLocomotion, insidePitch } from '../physics/locomotion'
import { assertValidMatchSetup } from '../../data/validate'
import {
  MAX_COMMANDS_PER_MATCH, applyDueMatchCommands, parseMatchCommandRequest,
  scheduleMatchCommand,
} from './commands'
import type {
  CommandReceipt, ScheduledMatchCommand, AppliedMatchCommand,
} from './commands'
import { createInitialMatchState } from './setup'
import {
  advanceOpeningKickoff, openingKickoffPass, OPENING_KICKOFF_COMMAND_ID,
} from './kickoff'
import {
  FOUNDATION_ENGINE_VERSION, MATCH_RANDOM_STREAM_IDS, MATCH_STATE_SCHEMA_VERSION,
} from './state'
import type { MatchState, PressingIntensity } from './state'

export const MATCH_CHECKPOINT_VERSION = 9 as const
export const MAX_ADVANCE_STEPS_PER_CALL = 10_000 as const

export interface FoundationMatchCheckpoint {
  readonly checkpointVersion: typeof MATCH_CHECKPOINT_VERSION
  readonly setup: MatchSetup
  readonly state: MatchState
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertCommand(
  value: unknown, applied: boolean, setup: MatchSetup,
): asserts value is ScheduledMatchCommand & Partial<AppliedMatchCommand> {
  if (!object(value)) throw new Error('Invalid checkpoint command')
  const fields = ['requestedTick', 'targetTick', 'sequence', 'appliedTick']
  const userFields = Object.fromEntries(Object.entries(value)
    .filter(([k]) => !fields.includes(k)))
  const result = parseMatchCommandRequest(userFields, setup.pitch)
  if ('reason' in result) throw new Error('Malformed checkpoint command: ' + result.reason)
  const expected = [...Object.keys(result.request),
    'requestedTick', 'targetTick', 'sequence', ...(applied ? ['appliedTick'] : [])]
  if (Object.keys(value).some((key) => !expected.includes(key))) {
    throw new Error('Unexpected checkpoint command field')
  }
  if (!Number.isSafeInteger(value.requestedTick) ||
      !Number.isSafeInteger(value.targetTick) ||
      !Number.isSafeInteger(value.sequence) ||
      (applied && !Number.isSafeInteger(value.appliedTick))) {
    throw new Error('Invalid checkpoint tick or sequence')
  }
  if (!applied && 'appliedTick' in value) throw new Error('Pending command marked as applied')
}

/**
 * Validate a complete current-version checkpoint before trusting saved state.
 * Limits enforce plausible motion but are NOT cryptographic save authentication.
 */
function validateRestoredState(setup: MatchSetup, input: unknown): MatchState {
  if (!object(input) || input.schemaVersion !== MATCH_STATE_SCHEMA_VERSION ||
      input.engineVersion !== FOUNDATION_ENGINE_VERSION ||
      input.matchId !== setup.matchId || input.seed !== setup.seed ||
      input.period !== 'notStarted') {
    throw new Error('Incompatible or invalid match state checkpoint')
  }
  const state = input as unknown as MatchState
  restoreSimulationClock(state.clock)
  if (!Array.isArray(state.players) || state.players.length !== 22 ||
      !Array.isArray(state.teams) || state.teams.length !== 2 ||
      !object(state.ball) || !object(state.randomStreams) ||
      !Array.isArray(state.pendingCommands) || !Array.isArray(state.appliedCommands) ||
      !Array.isArray(state.contactEvents) ||
      !Array.isArray(state.goalEvents) ||
      !Array.isArray(state.automaticContactEvents) ||
      !Number.isSafeInteger(state.ballContactCooldownUntilTick) ||
      state.ballContactCooldownUntilTick < 0 ||
      !object(state.ai) || !Array.isArray(state.ai.enabledTeams) ||
      !Array.isArray(state.ai.decisionSnapshot) ||
      !object(state.ai.formationPositions)) {
    throw new Error('Incomplete match state checkpoint')
  }
  const baseline = createInitialMatchState(setup).state
  if (state.teams.some((team, i) =>
    !object(team) || team.clubId !== baseline.teams[i].clubId ||
    team.attackingDirection !== baseline.teams[i].attackingDirection ||
    !Number.isSafeInteger(team.score) || team.score < 0 ||
    team.score !== state.goalEvents.filter(g =>
      g.scoringTeamId === team.clubId).length ||
    !['low', 'standard', 'high'].includes(team.pressingIntensity))) {
    throw new Error('Invalid team state in checkpoint')
  }
  // No restart yet: only one actual goal can conclude this exhibition.
  // The event is checked against team identity, physical line geometry,
  // last touch and current stopped ball—not a renderer counter.
  if (state.goalEvents.length > 1) throw new Error('Goal restarts are not implemented')
  if (state.goalEvents.length) {
    const ev = state.goalEvents[0]
    const scorer = state.players.find(p => p.playerId === ev?.lastTouchPlayerId)
    const goalTeam = state.teams.find(t => t.clubId === ev?.scoringTeamId)
    const expectedSide = goalTeam?.attackingDirection === 1 ? 'right' : 'left'
    const expectedX = expectedSide === 'right'
      ? setup.pitch.lengthM + BALL_RADIUS_M : -BALL_RADIUS_M
    if (!object(ev) || Object.keys(ev).sort().join(',') !==
        'crossingHeightM,crossingY,lastTouchPlayerId,ownGoal,scoringTeamId,side,tick' ||
        !scorer || !goalTeam || ev.side !== expectedSide ||
        typeof ev.ownGoal !== 'boolean' ||
        ev.ownGoal !== (scorer.clubId !== goalTeam.clubId) ||
        !Number.isSafeInteger(ev.tick) || ev.tick !== state.clock.tick ||
        ev.tick < 1 ||
        !Number.isFinite(ev.crossingY) ||
        !Number.isFinite(ev.crossingHeightM) ||
        Math.abs(ev.crossingY - setup.pitch.widthM / 2) >
          setup.pitch.goalWidthM / 2 - BALL_RADIUS_M + 1e-7 ||
        ev.crossingHeightM < BALL_RADIUS_M - 1e-7 ||
        ev.crossingHeightM > setup.pitch.goalHeightM - BALL_RADIUS_M + 1e-7 ||
        !state.ball.outsidePitch ||
        (expectedSide === 'right'
          ? state.ball.position.xM < expectedX
          : state.ball.position.xM > expectedX) ||
        state.ball.lastTouchPlayerId !== ev.lastTouchPlayerId ||
        state.kickoff?.phase === 'awaitingKick') {
      throw new Error('Goal event not supported by physical goalmouth state')
    }
  }
  if (Object.keys(state.randomStreams).length !== MATCH_RANDOM_STREAM_IDS.length) {
    throw new Error('Unexpected number of RNG streams')
  }
  for (const id of MATCH_RANDOM_STREAM_IDS) {
    const stream = restoreRandomStream(state.randomStreams[id])
    const cp = stream.checkpoint()
    if (cp.streamId !== id || cp.masterSeed !== setup.seed ||
        (id !== 'ball/contact' &&
          (cp.drawCount !== 0 ||
            JSON.stringify(cp.words) !== JSON.stringify(baseline.randomStreams[id].words)))) {
      throw new Error('Invalid or modified Phase 1 RNG stream')
    }
  }
  if (!Number.isSafeInteger(state.nextCommandSequence) ||
      state.nextCommandSequence < 1 ||
      state.nextCommandSequence > MAX_COMMANDS_PER_MATCH + 1) {
    throw new Error('Invalid command sequence counter')
  }
  const commands = [...state.pendingCommands, ...state.appliedCommands]
  if (commands.length !== state.nextCommandSequence - 1) {
    throw new Error('Missing or extra command history entries')
  }
  const ordered = [...commands].sort((a, b) => a.sequence - b.sequence)
  const seen = new Set<string>()
  for (let index = 0; index < ordered.length; index += 1) {
    const command = ordered[index]
    const applied = state.appliedCommands.includes(command as AppliedMatchCommand)
    assertCommand(command, applied, setup)
    if (command.sequence !== index + 1 ||
        command.targetTick !== command.requestedTick + 1 ||
        command.requestedTick < 0 || command.requestedTick > state.clock.tick ||
        command.targetTick > MAX_SIMULATION_TICK ||
        !setup.clubs.some((club) => club.id === command.teamId) ||
        ((command.type === 'setMovementTarget' ||
          command.type === 'attemptFirstTouch' ||
          command.type === 'attemptKick' ||
          command.type === 'setBallEngagement') && !setup.players.some(
          (p) => p.id === command.playerId && p.clubId === command.teamId)) ||
        seen.has(command.commandId)) {
      throw new Error('Invalid checkpoint command chronology')
    }
    if (applied) {
      if (command.appliedTick !== command.targetTick ||
          command.appliedTick > state.clock.tick) {
        throw new Error('Invalid applied command timing')
      }
    } else if (command.targetTick <= state.clock.tick) {
      throw new Error('Overdue movement or tactic command')
    }
    seen.add(command.commandId)
  }

  // Store tactical intent exactly as the ordered applied commands dictate.
  const tactics: Record<string, PressingIntensity> = Object.fromEntries(
    setup.clubs.map((club) => [club.id, 'standard' as const]),
  )
  const orderedApplied = [...state.appliedCommands].sort(
    (a, b) => a.targetTick - b.targetTick || a.sequence - b.sequence,
  )
  const lastMotion = new Map<string, Extract<AppliedMatchCommand, {type: 'setMovementTarget'}>>()
  const engagement = new Map(setup.players.map(p => [p.id, false]))
  const everAutonomous = new Set<string>()
  const expectedAIEnabled: [boolean, boolean] = [false, false]
  for (const command of orderedApplied) {
    if (command.type === 'setPressingIntensity') {
      tactics[command.teamId] = command.intensity
    } else if (command.type === 'setMovementTarget') {
      lastMotion.set(command.playerId, command as Extract<AppliedMatchCommand, {type: 'setMovementTarget'}>)
    } else if (command.type === 'setBallEngagement') {
      engagement.set(command.playerId, command.enabled)
    } else if (command.type === 'setAutonomousTeam') {
      const index = state.teams.findIndex(team => team.clubId === command.teamId)
      if (index < 0) throw new Error('AI command points to an absent team')
      expectedAIEnabled[index] = command.enabled
      if (command.enabled) everAutonomous.add(command.teamId)
    }
  }
  if (state.teams.some((team) => team.pressingIntensity !== tactics[team.clubId])) {
    throw new Error('Tactical state disagrees with command history')
  }

  // Team AI only becomes authoritative after an applied opt-in command.
  // The fixture anchors must remain exactly the validated initial positions.
  if (state.ai.enabledTeams.length !== 2 ||
      state.ai.enabledTeams.some((v,i) => v !== expectedAIEnabled[i]) ||
      JSON.stringify(state.ai.formationPositions) !==
        JSON.stringify(baseline.ai.formationPositions) ||
      !Number.isSafeInteger(state.ai.lastDecisionTick) ||
      state.ai.lastDecisionTick < -1 ||
      state.ai.lastDecisionTick > state.clock.tick ||
      !Number.isSafeInteger(state.ai.lastPassTick) ||
      state.ai.lastPassTick < -1000 ||
      state.ai.lastPassTick > state.clock.tick) {
    throw new Error('Invalid autonomous team/checkpoint state')
  }
  const generated = commands.filter(c =>
    c.type === 'attemptKick' && (c.commandId.startsWith('ai-pass-') || c.commandId.startsWith('ai-shot-')))
  const expectedLastPass = generated.length
    ? Math.max(...generated.map(c => c.requestedTick)) : -1000
  if (state.ai.lastPassTick !== expectedLastPass) {
    throw new Error('AI pass checkpoint does not match the physical kick commands')
  }
  // A selected receiver is temporary coordination metadata, not proof of
  // contact. Verify it against the actual next-tick physical kick request.
  if (state.ai.passIntent !== null) {
    const intent = state.ai.passIntent
    if (!object(intent) ||
        Object.keys(intent).sort().join(',') !==
          'commandId,passerId,receiverId,requestedTick,target,teamId') {
      throw new Error('Malformed coordinated-pass intent')
    }
    const candidate = commands.find(c => c.commandId === intent.commandId)
    const passer = state.players.find(p => p.playerId === intent.passerId)
    const receiver = state.players.find(p => p.playerId === intent.receiverId)
    const aiTeamIndex = state.teams.findIndex(t => t.clubId === intent.teamId)
    if (!candidate || candidate.type !== 'attemptKick' ||
        !candidate.commandId.startsWith('ai-pass-') ||
        candidate.teamId !== intent.teamId ||
        candidate.playerId !== intent.passerId ||
        candidate.requestedTick !== intent.requestedTick ||
        state.ai.lastPassTick !== intent.requestedTick ||
        !object(intent.target) || !insidePitch(intent.target, setup.pitch) ||
        JSON.stringify(candidate.target) !== JSON.stringify(intent.target) ||
        !passer || !receiver || passer.playerId === receiver.playerId ||
        passer.clubId !== intent.teamId || receiver.clubId !== intent.teamId ||
        aiTeamIndex < 0 || !state.ai.enabledTeams[aiTeamIndex] ||
        !Number.isSafeInteger(intent.requestedTick) ||
        intent.requestedTick < 0 || intent.requestedTick > state.clock.tick ||
        state.clock.tick > intent.requestedTick + 80) {
      throw new Error('Coordinated-pass intent disagrees with physical command history')
    }
  }
  const liveDecisions = new Set<string>()
  for (const d of state.ai.decisionSnapshot) {
    const teamIdx = state.teams.findIndex(t => t.clubId === d?.clubId)
    const player = state.players.find(p => p.playerId === d?.playerId)
    if (!d || typeof d !== 'object' ||
        Object.keys(d).sort().join(',') !==
          'action,clubId,engage,playerId,target,tick' ||
        !player || teamIdx < 0 || player.clubId !== d.clubId ||
        !state.ai.enabledTeams[teamIdx] ||
        !Number.isSafeInteger(d.tick) || d.tick !== state.ai.lastDecisionTick ||
        !['shape','support','press','pursue','carry','receive','cover','mark','recover','shoot','save'].includes(d.action) ||
        typeof d.engage !== 'boolean' ||
        !object(d.target) || !insidePitch(d.target, setup.pitch) ||
        liveDecisions.has(d.playerId)) {
      throw new Error('Invalid autonomous decision snapshot')
    }
    liveDecisions.add(d.playerId)
  }
  if (!everAutonomous.size &&
      (state.ai.lastDecisionTick !== -1 ||
        state.ai.decisionSnapshot.length !== 0 ||
        state.ai.lastPassTick !== -1000)) {
    throw new Error('Autonomous behavior occurred without team opt-in')
  }
  if (state.ai.lastDecisionTick === -1 && state.ai.decisionSnapshot.length) {
    throw new Error('Uninitialized AI cannot contain decisions')
  }
  if (state.ai.lastDecisionTick !== -1 &&
      !everAutonomous.size) {
    throw new Error('AI tick without prior activation')
  }

  // Validate precisely one recorded outcome per applied contact request.
  const attempts = orderedApplied.filter((command) =>
    command.type === 'attemptFirstTouch' || command.type === 'attemptKick')
  if (state.contactEvents.length !== attempts.length) {
    throw new Error('Missing or extra player-ball contact events')
  }
  let consumedDraws = 0
  const eventById = new Map<string, (typeof state.contactEvents)[number]>()
  for (let i = 0; i < attempts.length; i += 1) {
    const command = attempts[i]
    const recorded = state.contactEvents[i]
    if (!recorded || typeof recorded !== 'object' ||
        recorded.commandId !== command.commandId ||
        recorded.playerId !== command.playerId ||
        recorded.tick !== command.appliedTick ||
        recorded.kind !== (command.type === 'attemptKick' ? 'kick' : 'control') ||
        ![0, 1].includes(recorded.drawUsed) ||
        !(
          command.type === 'attemptKick'
            ? ['kicked', 'outOfReach', 'occupied', 'invalidDirection'].includes(recorded.outcome)
            : ['controlled', 'miscontrolled', 'outOfReach', 'occupied', 'alreadyControlled'].includes(recorded.outcome)
        ) ||
        recorded.drawUsed !== (['kicked', 'controlled', 'miscontrolled'].includes(recorded.outcome) ? 1 : 0) ||
        Object.keys(recorded).sort().join(',') !==
          'commandId,drawUsed,kind,outcome,playerId,tick') {
      throw new Error('Invalid player-ball contact event history')
    }
    consumedDraws += recorded.drawUsed
    eventById.set(recorded.commandId, recorded)
  }
  if (JSON.stringify(state.randomStreams['ball/contact']) !==
      JSON.stringify(expectedContactStream(setup.seed, consumedDraws))) {
    throw new Error('Contact RNG stream does not match the recorded draw history')
  }

  // Automatically resolved collisions have a separate ordered event log.
  // They use deterministic geometry and attributes, with no RNG draws.
  // Only engaged players can generate automatic interactions.
  let previousAutomaticTick = -AUTO_CONTACT_COOLDOWN_TICKS
  const autoByTick = new Map<number, (typeof state.automaticContactEvents)[number]>()
  for (const ev of state.automaticContactEvents) {
    if (!ev || typeof ev !== 'object' ||
        !Number.isSafeInteger(ev.tick) || ev.tick < 1 ||
        ev.tick > state.clock.tick ||
        ev.tick < previousAutomaticTick + AUTO_CONTACT_COOLDOWN_TICKS ||
        typeof ev.playerId !== 'string' ||
        !setup.players.some(p => p.id === ev.playerId) ||
        !Number.isFinite(ev.contactFraction) ||
        ev.contactFraction < 0 || ev.contactFraction > 1 ||
        !(
          (ev.kind === 'interception' &&
            ['intercepted', 'deflected'].includes(ev.outcome)) ||
          (ev.kind === 'challenge' &&
            ['wonChallenge', 'heldOff'].includes(ev.outcome))
        ) ||
        Object.keys(ev).sort().join(',') !==
          'contactFraction,kind,outcome,playerId,tick') {
      throw new Error('Invalid automatic ball contact history')
    }
    autoByTick.set(ev.tick, ev)
    previousAutomaticTick = ev.tick
  }
  const nextCooldown = state.automaticContactEvents.length
    ? state.automaticContactEvents[state.automaticContactEvents.length - 1].tick +
      AUTO_CONTACT_COOLDOWN_TICKS
    : 0
  if (state.ballContactCooldownUntilTick !== nextCooldown) {
    throw new Error('Ball contact cooldown disagrees with event history')
  }

  // Commands apply before motion; manual contacts after motion; automatic
  // contest resolves last. Reconstruct ownership from that chronology.
  let expectedController: string | null = null
  let expectedLastTouch: string | null = null
  const engagementAtTick = new Map(setup.players.map(p => [p.id, false]))
  const autonomousAtTick = new Map(setup.clubs.map(c => [c.id, false]))
  const ticks = [...new Set([
    ...orderedApplied.map(c => c.appliedTick),
    ...state.automaticContactEvents.map(e => e.tick),
  ])].sort((a, b) => a - b)
  for (const tick of ticks) {
    const due = orderedApplied.filter(c => c.appliedTick === tick)
    for (const cmd of due) {
      if (cmd.type === 'setBallEngagement') {
        engagementAtTick.set(cmd.playerId, cmd.enabled)
      } else if (cmd.type === 'setAutonomousTeam') {
        autonomousAtTick.set(cmd.teamId, cmd.enabled)
        if (!cmd.enabled) {
          for (const p of setup.players.filter(p => p.clubId === cmd.teamId)) {
            engagementAtTick.set(p.id, false)
          }
        }
      }
    }
    if (due.some(c => c.type === 'diagnosticBallLaunch')) {
      expectedController = null
      expectedLastTouch = null
    }
    for (const command of due) {
      if (command.type !== 'attemptFirstTouch' && command.type !== 'attemptKick') continue
      const recorded = eventById.get(command.commandId)
      if (!recorded) throw new Error('Missing applied contact outcome')
      if (recorded.outcome === 'controlled') {
        expectedController = command.playerId
        expectedLastTouch = command.playerId
      } else if (recorded.outcome === 'miscontrolled' ||
                 recorded.outcome === 'kicked') {
        expectedController = null
        expectedLastTouch = command.playerId
      }
    }
    const ev = autoByTick.get(tick)
    if (ev) {
      const contender = setup.players.find(p => p.id === ev.playerId)
      const owner = expectedController
        ? setup.players.find(p => p.id === expectedController)
        : undefined
      const wrongKind = owner ? ev.kind !== 'challenge' ||
        contender?.clubId === owner.clubId : ev.kind !== 'interception'
      const manualContact = state.contactEvents.some(e => e.tick === tick &&
        ['controlled', 'miscontrolled', 'kicked'].includes(e.outcome))
      const allowed = engagementAtTick.get(ev.playerId) ||
        autonomousAtTick.get(contender?.clubId ?? '')
      if (!allowed || wrongKind || manualContact ||
          due.some(c => c.type === 'diagnosticBallLaunch')) {
        throw new Error('Automatic contact is incompatible with engagement or ownership')
      }
      if (ev.outcome === 'intercepted' || ev.outcome === 'wonChallenge') {
        expectedController = ev.playerId
        expectedLastTouch = ev.playerId
      } else if (ev.outcome === 'deflected') {
        expectedController = null
        expectedLastTouch = ev.playerId
      }
    }
  }

  // Without a diagnostic launch or a reachable contact, the ball must remain
  // exactly at its original position. Other cases validate physical bounds.
  const launches = orderedApplied.filter((command) => command.type === 'diagnosticBallLaunch')
  if (!launches.length && state.automaticContactEvents.length === 0 &&
      !state.contactEvents.some((ev) =>
        ['kicked', 'miscontrolled', 'controlled'].includes(ev.outcome))) {
    if (JSON.stringify(state.ball) !== JSON.stringify(baseline.ball)) {
      throw new Error('Ball moved without an applied diagnostic launch')
    }
  } else {
    const ball = state.ball
    if (!object(ball.position) || !object(ball.velocity) ||
        typeof ball.heightM !== 'number' || !Number.isFinite(ball.heightM) ||
        ball.heightM < BALL_RADIUS_M - 1e-8 ||
        !Number.isFinite(ball.position.xM) || !Number.isFinite(ball.position.yM) ||
        Math.abs(ball.position.xM) > 3500 + setup.pitch.lengthM ||
        Math.abs(ball.position.yM) > 3500 + setup.pitch.widthM ||
        !Number.isFinite(ball.velocity.xMps) ||
        !Number.isFinite(ball.velocity.yMps) ||
        !Number.isFinite(ball.velocity.zMps) ||
        Math.hypot(ball.velocity.xMps, ball.velocity.yMps, ball.velocity.zMps) >
          MAX_LAUNCH_SPEED_MPS + 1e-8 ||
        (ball.heightM <= BALL_RADIUS_M + 1e-8 && ball.velocity.zMps < -1e-8) ||
        ball.controllerId !== expectedController ||
        ball.lastTouchPlayerId !== expectedLastTouch ||
        typeof ball.outsidePitch !== 'boolean' ||
        ball.outsidePitch !== isBallFullyOutsidePitch(
          ball.position.xM, ball.position.yM, setup.pitch)) {
      throw new Error('Ball checkpoint contains invalid flight, roll or contact state')
    }
    if (ball.controllerId !== null) {
      const player = state.players.find((p) => p.playerId === ball.controllerId)
      const offset = ball.controlOffset
      if (!player || !object(offset) ||
          !Number.isFinite(offset.xM) || !Number.isFinite(offset.yM) ||
          Math.hypot(offset.xM, offset.yM) > FOOT_REACH_M + 1e-9 ||
          ball.heightM !== BALL_RADIUS_M ||
          ball.velocity.zMps !== 0 ||
          Math.abs(ball.position.xM - (player.position.xM + offset.xM)) > 1e-8 ||
          Math.abs(ball.position.yM - (player.position.yM + offset.yM)) > 1e-8 ||
          ball.velocity.xMps !== player.velocity.xMps ||
          ball.velocity.yMps !== player.velocity.yMps) {
        throw new Error('Controlled ball is not physically attached to its owner')
      }
    } else if (ball.controlOffset !== null) {
      throw new Error('Free ball unexpectedly has a possession offset')
    }
  }

  // Kick-off must be a genuine validated physical kick, followed by
  // actual centre-ball movement. A forged start or unsupported restart is
  // rejected, while legacy non-kickoff diagnostic states stay unchanged.
  if (baseline.kickoff === null) {
    if (state.kickoff !== null) {
      throw new Error('Unexpected opening kick-off state in legacy fixture')
    }
  } else {
    const expected = baseline.kickoff
    const actual = state.kickoff
    if (!object(actual) ||
        Object.keys(actual).sort().join(',') !==
          'kickerId,phase,receiverId,takenTick,teamId' ||
        actual.teamId !== expected.teamId ||
        actual.kickerId !== expected.kickerId ||
        actual.receiverId !== expected.receiverId ||
        !['awaitingKick', 'inPlay'].includes(actual.phase as string)) {
      throw new Error('Invalid opening kick-off identity or phase')
    }

    const request = openingKickoffPass(baseline)
    const matching = commands.filter(c => c.commandId === OPENING_KICKOFF_COMMAND_ID)
    if (matching.length > 1 || (matching.length === 1 && (
      matching[0].type !== 'attemptKick' ||
      matching[0].teamId !== request.teamId ||
      matching[0].playerId !== request.playerId ||
      JSON.stringify(matching[0].target) !== JSON.stringify(request.target) ||
      matching[0].power !== request.power ||
      matching[0].lift !== request.lift ||
      matching[0].requestedTick !== 0 ||
      matching[0].targetTick !== 1
    ))) {
      throw new Error('Opening kick-off does not match the physical pass request')
    }
    const contact = state.contactEvents.find(e =>
      e.commandId === OPENING_KICKOFF_COMMAND_ID &&
      e.playerId === expected.kickerId && e.outcome === 'kicked')
    if (actual.phase === 'awaitingKick') {
      if (actual.takenTick !== null ||
          (contact && state.clock.tick > contact.tick)) {
        throw new Error('Opening kick-off is frozen despite a completed kick')
      }
    } else {
      if (!contact || typeof actual.takenTick !== 'number' ||
          !Number.isSafeInteger(actual.takenTick) ||
          actual.takenTick !== contact.tick + 1 ||
          actual.takenTick > state.clock.tick ||
          matching.length !== 1 ||
          !state.appliedCommands.some(c => c.commandId === OPENING_KICKOFF_COMMAND_ID)) {
        throw new Error('Kick-off cannot start without a real physical pass')
      }
    }
  }

  const currentPlayers = state.players
  for (let i = 0; i < currentPlayers.length; i += 1) {
    const player = currentPlayers[i]
    const original = baseline.players[i]
    if (!player || typeof player !== 'object') throw new Error('Invalid player state')

    const { position, velocity, orientationRad, intention, engagesBall, ...metadata } = player
    const {
      position: _initialPosition, velocity: _initialVelocity,
      orientationRad: _initialOrientation, intention: _initialIntention,
      engagesBall: _initialEngagement, ...expected
    } = original
    void _initialPosition
    void _initialVelocity
    void _initialOrientation
    void _initialIntention
    void _initialEngagement
    if (typeof engagesBall !== 'boolean' ||
        (!everAutonomous.has(player.clubId) &&
          engagesBall !== engagement.get(player.playerId))) {
      throw new Error('Player ball engagement does not match applied commands')
    }
    if (JSON.stringify(metadata) !== JSON.stringify(expected)) {
      throw new Error('Player identity, physical condition or roster was modified')
    }

    const motion = lastMotion.get(player.playerId)
    if (!motion && !everAutonomous.has(player.clubId)) {
      if (JSON.stringify({ ...player, engagesBall: false }) !==
          JSON.stringify(original)) {
        throw new Error('Player moved without an authoritative movement command')
      }
      continue
    }
    const definition = setup.players.find((p) => p.id === player.playerId)
    if (!definition || !insidePitch(position, setup.pitch) ||
        (!velocity || typeof velocity !== 'object' || Array.isArray(velocity)) || !Number.isFinite(velocity.xMps) ||
        !Number.isFinite(velocity.yMps) ||
        !Number.isFinite(orientationRad) ||
        orientationRad < -Math.PI - 1e-10 || orientationRad > Math.PI + 1e-10) {
      throw new Error('Invalid physical position, direction or velocity')
    }
    const limits = deriveMotionLimits(definition, player.energy)
    if (Math.hypot(velocity.xMps, velocity.yMps) > limits.maxSpeedMps + 1e-8) {
      throw new Error('Player exceeds their maximum physical speed')
    }
    if ((!intention || typeof intention !== 'object' || Array.isArray(intention)) || !Number.isSafeInteger(intention.sinceTick) ||
        intention.sinceTick < (everAutonomous.has(player.clubId) ? 0 : (motion?.appliedTick ?? 0)) ||
        intention.sinceTick > state.clock.tick) {
      throw new Error('Invalid player locomotion intention')
    }
    if (intention.kind === 'moveToPoint') {
      if ((!everAutonomous.has(player.clubId) &&
            intention.sinceTick !== motion?.appliedTick) ||
          (!intention.target || typeof intention.target !== 'object' || Array.isArray(intention.target)) ||
          !insidePitch(intention.target, setup.pitch) ||
          (!everAutonomous.has(player.clubId) &&
            JSON.stringify(intention.target) !== JSON.stringify(motion?.target))) {
        throw new Error('Movement target differs from the latest applied instruction')
      }
    } else if (intention.kind === 'holdFormation') {
      if (velocity.xMps !== 0 || velocity.yMps !== 0) {
        throw new Error('Idle player still has physical velocity')
      }
    } else {
      throw new Error('Unsupported player locomotion intention')
    }
  }
  return state
}

/** Match state is private; the client only receives detached snapshots. */
export class FoundationMatchEngine {
  private readonly setup: MatchSetup
  private state: MatchState

  private constructor(setup: MatchSetup, state: MatchState) {
    this.setup = setup
    this.state = state
  }

  static create(input: unknown): FoundationMatchEngine {
    const { setup, state } = createInitialMatchState(input)
    return new FoundationMatchEngine(setup, state)
  }

  static restore(input: unknown): FoundationMatchEngine {
    if (!object(input) || input.checkpointVersion !== MATCH_CHECKPOINT_VERSION) {
      throw new Error('Unsupported movement-engine checkpoint version')
    }
    const setup = structuredClone(assertValidMatchSetup(input.setup))
    const restored = validateRestoredState(setup, input.state)
    return new FoundationMatchEngine(setup, structuredClone(restored))
  }

  getState(): MatchState { return structuredClone(this.state) }
  getSetup(): MatchSetup { return structuredClone(this.setup) }

  submitCommand(request: unknown): CommandReceipt {
    const { state, receipt } = scheduleMatchCommand(this.state, request, this.setup.pitch)
    this.state = state
    return receipt
  }

  /** Fixed-step player and free-ball physics; no actual football gameplay. */
  advance(steps = 1): MatchState {
    if (!Number.isSafeInteger(steps) || steps < 0 ||
        steps > MAX_ADVANCE_STEPS_PER_CALL ||
        steps > MAX_SIMULATION_TICK - this.state.clock.tick) {
      throw new RangeError('Invalid engine advance step count')
    }
    for (let i = 0; i < steps; i += 1) {
      if (this.state.goalEvents.length) break
      const clock = advanceSimulationClock(this.state.clock)
      const applied = applyDueMatchCommands({ ...this.state, clock })
      const planned = runAutonomousDecisions(applied, this.setup)
      const agents = advancePlayerLocomotion(planned, this.setup.players, this.setup.pitch)
      const controller = agents.ball.controllerId
        ? agents.players.find((p) => p.playerId === agents.ball.controllerId)
        : null
      if (agents.ball.controllerId && !controller) {
        throw new Error('Ball controller is missing')
      }
      const ball = controller
        ? advanceControlledBall(agents.ball, controller, this.setup.pitch)
        : advanceBallPhysics(agents.ball, this.setup.pitch)
      const moved = ball === agents.ball ? agents : { ...agents, ball }
      const contacted = resolveContactAttempts(moved, this.setup)
      const kickedOff = advanceOpeningKickoff(contacted, this.setup)
      // Physical tackles and failed kicks can invalidate a pass chosen
      // earlier in this same tick. Retire stale receiver instructions NOW,
      // rather than letting a teammate chase a ball already lost.
      const resolved = resolveAutomaticBallContact(this.state, kickedOff, this.setup)
      this.state = adjudicatePhysicalGoal(this.state,
        maintainPassReception(resolved, this.setup), this.setup)
    }
    return this.getState()
  }

  checkpoint(): FoundationMatchCheckpoint {
    return {
      checkpointVersion: MATCH_CHECKPOINT_VERSION,
      setup: this.getSetup(), state: this.getState(),
    }
  }
}

export function createFoundationMatch(input: unknown): FoundationMatchEngine {
  return FoundationMatchEngine.create(input)
}
export function restoreFoundationMatch(input: unknown): FoundationMatchEngine {
  return FoundationMatchEngine.restore(input)
}
