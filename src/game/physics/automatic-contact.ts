
import { BALL_RADIUS_M, isBallFullyOutsidePitch } from './ball'
import { FOOT_CONTACT_MAX_HEIGHT_M, FOOT_REACH_M } from './contact'
import type { MatchState, BallMatchState, PlayerMatchState, AutomaticContactEvent } from '../match/state'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import { activePhysicalShot } from '../ai/goal-directed'
import { GOALKEEPER_HAND_HEIGHT_M } from './goalkeeper-handling'
import { goalkeeperCatchStretchPenalty, goalkeeperSaveWindow } from './goalkeeper-saves'
import { planGoalkeeperOneOnOne } from '../ai/goalkeeper-one-on-one'
import { forbiddenThrowInSecondTouch } from '../match/restarts'
import { activeAerialDelivery, goalkeeperCrossHandReach } from '../ai/goalkeeper-aerial'
import { activeOutfieldAerialDelivery } from '../ai/aerial-duels'
import { outfieldHeaderReach, redirectPhysicalHeader } from './aerial-heading'
import { forbiddenRestartSecondTouch } from '../match/restarts'

/**
 * Phase 4 — physical detection when an agent has declared intent to contest.
 * No strategy/AI chooses whom to engage. All values below are estimated,
 * deterministic mechanics; there is no hidden outcome generator.
 */
export const AUTOMATIC_CONTACT_VERSION = 'post-kick-separation-box-f1-v1' as const
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
  readonly header: boolean
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
  minHeightM = BALL_RADIUS_M,
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
  // Clamp the swept interval to the ACTUAL vertical collision range.
  // Head and feet must never both claim the same 2D proximity at a
  // different height. For ordinary foot interactions minHeightM is the
  // ground ball radius, preserving earlier foot/keeper calculations.
  if (Math.min(h0,ballAfter.heightM)>maxHeightM ||
      Math.max(h0,ballAfter.heightM)<minHeightM) return null
  if (dh > 0) {
    lo = Math.max(lo,(minHeightM-h0)/dh)
    hi = Math.min(hi,(maxHeightM-h0)/dh)
  } else if (dh < 0) {
    lo = Math.max(lo,(maxHeightM-h0)/dh)
    hi = Math.min(hi,(minHeightM-h0)/dh)
  } else if(h0<minHeightM || h0>maxHeightM) return null
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

function withinOwnPenaltyArea(
  player: PlayerMatchState, setup: MatchSetup,
): boolean {
  const home = player.clubId === setup.clubs[0].id
  const away = player.clubId === setup.clubs[1].id
  if (!home && !away) return false
  const {lengthM,widthM,penaltyAreaDepthM,penaltyAreaWidthM} = setup.pitch
  return (home ? player.position.xM >= 0 &&
    player.position.xM <= penaltyAreaDepthM
    : player.position.xM <= lengthM &&
      player.position.xM >= lengthM - penaltyAreaDepthM) &&
    Math.abs(player.position.yM - widthM / 2) <= penaltyAreaWidthM / 2
}

/** A real hand reception from a physically swept collision. */
function attachToHands(
  ball: BallMatchState, keeper: PlayerMatchState,
  pitch: MatchSetup['pitch'],
): BallMatchState {
  const offset = {
    xM: Math.cos(keeper.orientationRad) * .28,
    yM: Math.sin(keeper.orientationRad) * .28,
  }
  const position = {
    xM: keeper.position.xM + offset.xM,
    yM: keeper.position.yM + offset.yM,
  }
  return {
    ...ball, position, heightM: GOALKEEPER_HAND_HEIGHT_M,
    velocity: {...keeper.velocity, zMps: 0},
    controllerId: keeper.playerId, controlOffset: offset,
    lastTouchPlayerId: keeper.playerId,
    outsidePitch: isBallFullyOutsidePitch(position.xM, position.yM, pitch),
  }
}

/**
 * A held-off tackle is a *failed* physical attempt, not a new collision on
 * every cooldown expiry. If the same defender remains inside the controller's
 * original foot-contact envelope, no fresh swept entry has occurred.
 *
 * Re-arm when the defender is outside reach at the start of a future tick
 * and physically closes again, or whenever some other genuine touch changes
 * the phase. This avoids indefinite HELD OFF event spam and expensive
 * ever-growing iPhone event-log clones without inventing an awarded tackle.
 */
function alreadyHeldOffWithoutReapproach(
  before: MatchState, after: MatchState,
  playerBefore: PlayerMatchState, playerAfter: PlayerMatchState,
): boolean {
  const controller = before.ball.controllerId
  if (controller === null || after.ball.controllerId !== controller ||
      playerAfter.clubId === before.players.find(p =>
        p.playerId === controller)?.clubId) return false
  const gap = Math.hypot(
    playerBefore.position.xM - before.ball.position.xM,
    playerBefore.position.yM - before.ball.position.yM,
  )
  // A genuinely new entry across the contact envelope is allowed to
  // challenge the current owner, including after an earlier lost tackle.
  if (gap > FOOT_REACH_M + 1e-8) return false

  let lastManualTouch = -1
  for (let i = after.contactEvents.length - 1; i >= 0; i--) {
    const touch = after.contactEvents[i]
    if (touch.outcome === 'controlled' || touch.outcome === 'miscontrolled' ||
        touch.outcome === 'kicked' || touch.outcome === 'thrown') {
      lastManualTouch = touch.tick
      break
    }
  }
  for (let i = after.automaticContactEvents.length - 1; i >= 0; i--) {
    const event = after.automaticContactEvents[i]
    // A new interception/tackle/deflection starts a different physical
    // contest. Failed contacts by other players do not reset this one.
    if (event.outcome === 'intercepted' || event.outcome === 'wonChallenge' ||
        event.outcome === 'deflected' || event.outcome === 'caught' ||
        event.outcome === 'parried' || event.outcome === 'punched')
      return false
    if (event.playerId === playerAfter.playerId &&
        event.outcome === 'heldOff')
      return event.tick > lastManualTouch
  }
  return false
}

/**
 * BOX-F1: an executed FOOT KICK starts with the ball physically overlapping
 * the kicker's contact envelope. This is the kick leaving the foot, NOT a
 * second interception. Do not let the still-engaged kicker immediately
 * deflect their own outgoing shot/pass/clearance while it separates.
 *
 * The earliest valid blocker, teammate or goalkeeper is UNRESTRICTED.
 * Once the ball has actually separated beyond foot reach it can return and
 * be contested normally (including a goalframe rebound). The brief initial
 * grace also covers a ball that temporarily crosses the shooter's feet.
 * No state fields, special ownership, ball teleport or artificial goal.
 */
export function outgoingKickStillSeparating(
  before: MatchState, after: MatchState,
  player: PlayerMatchState,
): boolean {
  if (after.ball.controllerId !== null ||
      before.ball.controllerId !== null ||
      after.ball.lastTouchPlayerId !== player.playerId) return false

  // A current physical contact by another player replaces the kicked
  // ball's provenance. Ignore failed contact attempts, which change none.
  let latest: MatchState['contactEvents'][number] | undefined
  for (let i = after.contactEvents.length - 1; i >= 0; i--) {
    const event = after.contactEvents[i]
    if (after.clock.tick - event.tick > 8) break
    if (['controlled','miscontrolled','kicked','thrown','thrownIn',
      'goalKicked','cornerKicked'].includes(event.outcome)) {
      latest = event
      break
    }
  }
  if (!latest || latest.playerId !== player.playerId ||
      !['kicked','goalKicked','cornerKicked'].includes(latest.outcome))
    return false
  const age = after.clock.tick - latest.tick
  if (age < 1 || age > 8) return false
  const beforePlayer = before.players.find(p =>
    p.playerId === player.playerId)
  if (!beforePlayer) return false
  const previousGap = Math.hypot(
    before.ball.position.xM - beforePlayer.position.xM,
    before.ball.position.yM - beforePlayer.position.yM)
  // An outgoing ball that has ALREADY exited the foot envelope is live
  // to be played again upon genuine return. Don't block normal rebounds.
  if (previousGap > FOOT_REACH_M + .02) return false
  const nextGap = Math.hypot(
    after.ball.position.xM - player.position.xM,
    after.ball.position.yM - player.position.yM)
  // The kick's first 100ms is the ongoing physical release, not a new
  // touch. Thereafter only continued *outward separation* is protected,
  // so an incoming real rebound is contestable.
  return age <= 2 || nextGap > previousGap + .015
}

function candidate(
  before: MatchState, after: MatchState, owner: PlayerMatchState | undefined,
  setup: MatchSetup,
): Candidate | null {
  const pastPlayers = new Map(before.players.map(p => [p.playerId, p]))
  const options: Candidate[] = []
  const shot = activePhysicalShot(after)
  const shooter = shot && after.players.find(p => p.playerId === shot.shooterId)
  const delivered = !owner && activeOutfieldAerialDelivery(after,setup)
  for (const p of after.players) {
    // A kick-off taker may not touch the ball again until another player
    // touches it; skip the taker during this protected opening passage.
    if (after.kickoff?.phase === 'inPlay' &&
        before.ball.lastTouchPlayerId === after.kickoff.kickerId &&
        p.playerId === after.kickoff.kickerId) continue
    if (!p.engagesBall || p.participation !== 'onField' ||
      forbiddenThrowInSecondTouch(after, p.playerId) ||
      outgoingKickStillSeparating(before, after, p) ||
      p.playerId === owner?.playerId ||
      (owner && p.clubId === owner.clubId)) continue
    const old = pastPlayers.get(p.playerId)
    if (!old) continue
    // Keepers use a modest aerial hand-reach envelope ONLY while responding
    // to a confirmed opposition shot. The sweep still checks real motion.
    const goalkeeperSave = p.formationSlot === 'GK' &&
      !!shooter && shooter.clubId !== p.clubId &&
      withinOwnPenaltyArea(p, setup)
    // Aerial interceptions need goalkeeper attributes too: the previous
    // shot-only lookup silently fell back to foot contact for crosses.
    const definition = p.formationSlot === 'GK'
      ? setup.players.find(def => def.id === p.playerId) : undefined
    const saveWindow = goalkeeperSave && shot &&
      definition?.abilities.goalkeeping
      ? goalkeeperSaveWindow(definition, after.clock.tick, shot.tick)
      : null
    // A point-blank shot can hit the keeper's body immediately. Extended
    // hands and dives become reachable only after the reflex delay.
    // A genuine one-on-one smother uses a short ground-level hand reach.
    // It cannot invent a catch: the ball must actually sweep through this
    // contact envelope while a specific keeper is engaging the dribbler.
    const team = after.teams.find(t => t.clubId === p.clubId)
    const smother = p.formationSlot === 'GK' && owner && team &&
      withinOwnPenaltyArea(p, setup) &&
      planGoalkeeperOneOnOne(after, setup, p, team)?.engage === true
    const aerial = p.formationSlot === 'GK' && !owner && team &&
      withinOwnPenaltyArea(p, setup) &&
      !!activeAerialDelivery(after, setup, team) &&
      !!definition?.abilities.goalkeeping
    const reach = aerial && definition
      ? goalkeeperCrossHandReach(definition) : null
    const physical = sweptFootContact(old, p, before.ball, after.ball,
      saveWindow?.reachM ?? reach?.horizontalM ??
        (smother ? 1.05 : FOOT_REACH_M),
      saveWindow?.maximumHeightM ?? reach?.maximumHeightM ??
        FOOT_CONTACT_MAX_HEIGHT_M)
    const headingDecision = delivered && p.formationSlot!=='GK' &&
      !forbiddenRestartSecondTouch(after,p.playerId)
      ? after.ai.decisionSnapshot.find(d=>
          d.playerId===p.playerId && d.action==='head' && d.engage)
      : undefined
    const headerDefinition = headingDecision &&
      setup.players.find(d=>d.id===p.playerId)
    const headerReach = headerDefinition &&
      outfieldHeaderReach(p,headerDefinition,
        (after.clock.tick-headingDecision!.tick)*.05)
    const headerSample = headerReach &&
      after.clock.tick-headingDecision!.tick>=2
      ? sweptFootContact(old,p,before.ball,after.ball,
          headerReach.horizontalM,headerReach.maximumHeightM,
          headerReach.minimumHeightM)
      : null
    const result=headerSample ?? physical
    if (!result) continue
    // The goalkeeper's BODY being inside the box does not legalize a hand
    // claim where the actual ball impact is outside the penalty boundary.
    if (aerial && !withinOwnPenaltyArea({
      ...p, position: result.impact,
    }, setup)) continue
    if (owner && alreadyHeldOffWithoutReapproach(
      before, after, old, p)) continue
    options.push({ player: p, sample: result, header: !!headerSample })
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
      ['controlled', 'miscontrolled', 'kicked', 'thrown'].includes(e.outcome))) return after
  if (after.ball.outsidePitch && before.ball.outsidePitch) return after
  if (!after.players.some(p => p.engagesBall)) return after

  const owner = after.ball.controllerId
    ? after.players.find(p => p.playerId === after.ball.controllerId)
    : undefined
  const picked = candidate(before, after, owner, setup)
  if (!picked) return after
  const { player, sample } = picked
  if (isBallFullyOutsidePitch(sample.impact.xM, sample.impact.yM, setup.pitch)) return after

  const definition = setup.players.find(d => d.id === player.playerId)
  if (!definition) throw new Error('Missing contender in authoritative match setup')
  if(picked.header){
    const delivered=activeOutfieldAerialDelivery(after,setup)
    if(!delivered) return after
    // The real airborne ball and the real 50ms player movement intersect
    // the header envelope. Whichever opponent meets it first wins this
    // contact, including a goalkeeper's earlier valid glove collision.
    const impactHeight=before.ball.heightM+
      sample.fraction*(after.ball.heightM-before.ball.heightM)
    const redirected=redirectPhysicalHeader(after,setup,player,definition,
      {impact:sample.impact,fraction:sample.fraction,
        distanceM:sample.distanceM,heightM:impactHeight},
      delivered.kickerClubId)
    const recorded:AutomaticContactEvent={
      tick,playerId:player.playerId,kind:'header',
      outcome:redirected.outcome,contactFraction:sample.fraction,
    }
    return {...after,ball:redirected.ball,
      ballContactCooldownUntilTick:tick+AUTO_CONTACT_COOLDOWN_TICKS,
      automaticContactEvents:[...after.automaticContactEvents,recorded]}
  }
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
    const team = after.teams.find(t => t.clubId === player.clubId)
    const abilities = definition.abilities
    const smother = player.formationSlot === 'GK' && !!team &&
      abilities.goalkeeping !== null &&
      withinOwnPenaltyArea(player, setup) &&
      after.ball.heightM <= .45 &&
      planGoalkeeperOneOnOne(after, setup, player, team)?.engage === true
    if (smother && abilities.goalkeeping) {
      const keeper = abilities.goalkeeping
      const smotherControl =
        .40 * keeper.oneOnOnes + .25 * keeper.rushingOut +
        .20 * keeper.handling + .15 * abilities.mental.anticipation
      const carrierControl =
        .38 * ownerDef.abilities.technical.dribbling +
        .22 * ownerDef.abilities.technical.firstTouch +
        .22 * ownerDef.abilities.mental.composure +
        .18 * ownerDef.abilities.physical.balance
      // A sprinting collision is hard to secure. Actual swept ball contact
      // is mandatory regardless of ratings; no RNG awards a smother.
      const difficulty = sample.distanceM * 5 +
        Math.max(0, approach - 6) * 1.5
      if (smotherControl >= carrierControl + difficulty + 1.5) {
        ball = attachToHands(ball, player, setup.pitch)
        outcome = 'caught'
      } else {
        outcome = 'heldOff'
      }
    } else if (challenge + Math.min(7, approach * 0.85) >= protection + 1.5) {
      ball = attachTo(ball, player, sample.impact, setup.pitch)
      outcome = 'wonChallenge'
    } else {
      outcome = 'heldOff'
    }
  } else {
    kind = 'interception'
    const activeShot = activePhysicalShot(after)
    const keeperSave = player.formationSlot === 'GK' &&
      !!definition.abilities.goalkeeping && !!activeShot &&
      withinOwnPenaltyArea(player, setup)
    const saveWindow = keeperSave && activeShot
      ? goalkeeperSaveWindow(definition, tick, activeShot.tick)
      : null
    const team = after.teams.find(t => t.clubId === player.clubId)
    const aerial = player.formationSlot === 'GK' && !!team &&
      !!definition.abilities.goalkeeping &&
      withinOwnPenaltyArea(player, setup) &&
      !!activeAerialDelivery(after, setup, team)
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
      9 * sample.distanceM / (saveWindow?.reachM ?? FOOT_REACH_M)
    const impactHeight = before.ball.heightM + sample.fraction *
      (after.ball.heightM - before.ball.heightM)
    const stretchPenalty = saveWindow
      ? goalkeeperCatchStretchPenalty(sample.distanceM, impactHeight, saveWindow)
      : 0
    // Physically close, low-speed contacts can be caught. A late stretch
    // or high ball is more likely to be pushed clear than held securely.
    // A missed sweep never enters this branch, so it remains a real miss.
    const cleanCatch = keeperSave &&
      quality - challengeDifficulty - stretchPenalty >= 37 &&
      relativeSpeed <= 20
    if (aerial && definition.abilities.goalkeeping) {
      const gk = definition.abilities.goalkeeping
      const gloveQuality = .43 * gk.crossClaiming +
        .30 * gk.handling + .17 * gk.commandOfArea +
        .10 * definition.abilities.mental.concentration
      let congestion = 0
      for (const opponent of after.players) {
        if (opponent.clubId !== player.clubId &&
            opponent.formationSlot !== 'GK' &&
            Math.hypot(
              opponent.position.xM - sample.impact.xM,
              opponent.position.yM - sample.impact.yM) < 2.25) {
          congestion += 7
        }
      }
      const difficulty = relativeSpeed * .65 +
        Math.max(0, impactHeight - 1.2) * 10 +
        sample.distanceM * 7 +
        Math.min(18, congestion)
      // No generated success roll: a REAL glove contact either securely
      // claims the incoming cross or punches it away under pressure.
      if (gloveQuality - difficulty >= 25) {
        ball = attachToHands(ball, player, setup.pitch)
        outcome = 'caught'
      } else {
        const outward = player.clubId === setup.clubs[0].id ? 1 : -1
        const side = sample.impact.yM >= setup.pitch.widthM / 2 ? 1 : -1
        const punch = gk.punching / 100
        const x = outward * (.82 + .25 * punch)
        const y = side * (.45 + .35 * punch)
        const magnitude = Math.hypot(x, y)
        const horizontal = Math.hypot(
          ball.velocity.xMps, ball.velocity.yMps)
        const speed = Math.min(17, 4.5 + horizontal * .23 +
          gk.punching * .065)
        ball = {
          ...ball,
          position: { ...sample.impact },
          heightM: Math.max(BALL_RADIUS_M, impactHeight),
          velocity: {
            xMps: player.velocity.xMps * .25 + x / magnitude * speed,
            yMps: player.velocity.yMps * .25 + y / magnitude * speed,
            zMps: 1.2 + gk.punching * .009,
          },
          controllerId: null, controlOffset: null,
          lastTouchPlayerId: player.playerId,
          outsidePitch: isBallFullyOutsidePitch(
            sample.impact.xM, sample.impact.yM, setup.pitch),
        }
        outcome = 'punched'
      }
    } else if (cleanCatch) {
      ball = attachToHands(ball, player, setup.pitch)
      outcome = 'caught'
    } else if (!keeperSave && quality - challengeDifficulty >= 24) {
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
      // Parrying skill influences the direction and strength of a REAL
      // glove contact, favouring an outward deflection into the field.
      // Poorer keepers exert less control; no rebound destination or
      // successful save is manufactured.
      const parrying = keeperSave
        ? definition.abilities.goalkeeping!.parrying / 100 : 0
      const outward = player.clubId === setup.clubs[0].id ? 1 : -1
      const pushX = nx + (keeperSave ? outward * (.15 + .30 * parrying) : 0)
      const pushY = ny
      const pushLength = Math.hypot(pushX, pushY) || 1
      const reboundSpeed = Math.min(18, 1.2 + 0.27 * horizontal) *
        (keeperSave ? .72 + .35 * parrying : 1)
      const position = { ...sample.impact }
      ball = {
        ...ball, position, heightM: Math.max(BALL_RADIUS_M,
          impactHeight),
        velocity: {
          xMps: player.velocity.xMps * 0.4 +
            pushX / pushLength * reboundSpeed,
          yMps: player.velocity.yMps * 0.4 +
            pushY / pushLength * reboundSpeed,
          zMps: Math.max(0, ball.velocity.zMps) * 0.35,
        },
        controllerId: null, controlOffset: null,
        lastTouchPlayerId: player.playerId,
        outsidePitch: isBallFullyOutsidePitch(position.xM, position.yM, setup.pitch),
      }
      outcome = keeperSave ? 'parried' : 'deflected'
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
