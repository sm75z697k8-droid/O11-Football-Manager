import type { PlayerDefinition } from '../model/player'
import type { MatchSetup } from '../model/match'
import type { Point2 } from '../model/pitch'
import type { BallMatchState, MatchState, PlayerMatchState } from '../match/state'
import { isBallFullyOutsidePitch } from './ball'

/**
 * COR-S1: physical, ability-sensitive outfield headings.
 *
 * Player xy motion and the ball's xyz flight remain authoritative. As the
 * players are rendered in 2D, a bounded virtual jump reach is derived from
 * the actual head height, individual leap and elapsed *tactical* engagement
 * time. A declared header never creates a touch without a swept collision.
 * These are estimated football-simulation values, not empirical probabilities.
 */
export const OUTFIELD_HEADING_VERSION = 'swept-aerial-heading-cor-s1-v1'
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n))

export interface HeaderReach {
  readonly minimumHeightM: number
  readonly maximumHeightM: number
  readonly horizontalM: number
  readonly baseHeadHeightM: number
  readonly jumpRiseM: number
}

export function outfieldHeaderReach(
  player: PlayerMatchState, definition: PlayerDefinition,
  elapsedSinceDecisionSeconds: number,
): HeaderReach {
  if(player.formationSlot==='GK' || definition.abilities.goalkeeping)
    throw new Error('Outfield header reach cannot replace goalkeeper hands')
  const head=clamp(definition.profile.heightCm/100-.17,1.33,2.04)
  const jumpPotential=(.18+.0063*definition.abilities.physical.verticalLeap)*
    clamp(.53+.47*player.energy/100,.48,1)
  const reaction=.105+
    (100-definition.abilities.mental.anticipation)*.00075
  // The 2D agent can start rising only AFTER a physically elapsed
  // recognition delay. Peak reach takes another ~0.28 seconds.
  const elapsed=Math.max(0,elapsedSinceDecisionSeconds)
  const rise=clamp((elapsed-reaction)/.28,0,1)
  const decline=clamp((.82-elapsed)/.23,0,1)
  const jump=jumpPotential*Math.min(rise,decline)
  return {
    minimumHeightM:Math.max(.97,head-.43),
    maximumHeightM:head+jump,
    horizontalM:.64+.0011*definition.abilities.physical.agility+
      .0012*definition.abilities.mental.bravery,
    baseHeadHeightM:head,
    jumpRiseM:jump,
  }
}

export interface HeaderContact {
  readonly impact: Point2
  readonly fraction: number
  readonly distanceM: number
  readonly heightM: number
}

export interface HeadingResult {
  readonly ball: BallMatchState
  readonly outcome:'headed'|'glanced'
  readonly attacking: boolean
}

/**
 * On genuine contact, redirect the INCOMING ball using player abilities,
 * incoming velocity, body orientation and defender proximity. Not one goal,
 * successful header or clearance is predetermined. Opposing heading
 * candidates compete for one real ball in the shared swept-contact resolver.
 */
export function redirectPhysicalHeader(
  state:MatchState,setup:MatchSetup,player:PlayerMatchState,
  definition:PlayerDefinition,contact:HeaderContact,
  kickerClubId:string,
):HeadingResult {
  const b=state.ball
  const team=state.teams.find(t=>t.clubId===player.clubId)
  if(!team)throw new Error('Missing heading team')
  const attacking=player.clubId===kickerClubId
  const opponents=state.players.filter(p=>p.clubId!==player.clubId &&
    Math.hypot(p.position.xM-contact.impact.xM,
      p.position.yM-contact.impact.yM)<1.65).length
  const a=definition.abilities
  const speed=Math.hypot(b.velocity.xMps,b.velocity.yMps)
  const quality=(.53*a.technical.heading+.17*a.technical.technique+
    .15*a.mental.bravery+.15*a.mental.composure)/100
  const difficulty=speed*.42+opponents*5+
    Math.abs(contact.heightM-(definition.profile.heightCm/100-.17))*5+
    contact.distanceM*3
  const controlled=quality*100-difficulty>=28
  const ballOut=(velocity:{xMps:number;yMps:number;zMps:number}):BallMatchState=>({
    ...b,position:{...contact.impact},heightM:contact.heightM,
    velocity,controllerId:null,controlOffset:null,
    lastTouchPlayerId:player.playerId,
    outsidePitch:isBallFullyOutsidePitch(contact.impact.xM,
      contact.impact.yM,setup.pitch),
  })
  if(!controlled){
    // A real glancing contact: incoming momentum and body motion remain
    // important. In particular this does NOT attach the ball to the head.
    const speedScale=clamp(.42+.14*quality,.42,.58)
    const velocity={
      xMps:b.velocity.xMps*speedScale+
        Math.cos(player.orientationRad)*(2.2+quality*2)+
        player.velocity.xMps*.14,
      yMps:b.velocity.yMps*speedScale+
        Math.sin(player.orientationRad)*(2.2+quality*2)+
        player.velocity.yMps*.14,
      zMps:clamp(b.velocity.zMps*.15+.8, -.8,3),
    }
    return {ball:ballOut(velocity),outcome:'glanced',attacking}
  }
  const goalX=team.attackingDirection===1?setup.pitch.lengthM:0
  const target=attacking
    ? {xM:goalX,yM:setup.pitch.widthM/2+
        clamp((contact.impact.yM-setup.pitch.widthM/2)*.055,-1.1,1.1)}
    : {xM:clamp(contact.impact.xM+team.attackingDirection*30,2,
        setup.pitch.lengthM-2),
       yM:clamp(contact.impact.yM+
         (contact.impact.yM>=setup.pitch.widthM/2?8:-8),3,
         setup.pitch.widthM-3)}
  const dx=target.xM-contact.impact.xM
  const dy=target.yM-contact.impact.yM
  const aim=Math.atan2(dy,dx)
  const facingError=Math.atan2(Math.sin(aim-player.orientationRad),
    Math.cos(aim-player.orientationRad))
  // Incoming spin/angle and how the player met the ball shape inaccuracy;
  // heading skill reduces, but does not suppress, the physical mismatch.
  const sideways=b.velocity.xMps*Math.sin(aim)-
    b.velocity.yMps*Math.cos(aim)
  const error=clamp((1-quality)*.22*facingError+
    sideways*.0035*(1-quality)+
    (contact.distanceM-.36)*.13*(1-quality),-.27,.27)
  const direction=aim+error
  const outgoingSpeed=clamp(5.2+.075*a.technical.heading+
    .043*a.physical.strength+speed*.22,8,20.5)
  const upward=attacking
    ? clamp(.85+(1-quality)*1.5+
      Math.abs(facingError)*.19, .55,3.4)
    : clamp(2.6+quality*1.35,2.5,4)
  return {ball:ballOut({
    xMps:Math.cos(direction)*outgoingSpeed,
    yMps:Math.sin(direction)*outgoingSpeed,
    zMps:upward,
  }),outcome:'headed',attacking}
}
