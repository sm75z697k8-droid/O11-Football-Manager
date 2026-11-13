import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import {
  createFoundationMatch, restoreFoundationMatch,
} from '../../src/game/match/engine'

describe('S1.4 real kicked goal -> full 22-player restart', () => {
  it('physically scores and completes a conceding-team kickoff with checkpoint replay', () => {
    const samples: Array<{
      seed: number; movedToBall: number; kicked: string | null;
      goals: number; postGoalComplete: boolean;
    }> = []
    let complete = false
    for (const seed of [117,42,832,90,101,205,2317,123456789,19,53]) {
      const fixture = { ...makeFictionalMatchSetup(), seed }
      const game = createFoundationMatch(fixture)
      const initial = game.getState()
      const kicker = initial.players.find(p =>
        p.clubId === fixture.clubs[0].id && p.formationSlot === 'DM')!
      const centre = {
        xM: fixture.pitch.lengthM / 2,
        yM: fixture.pitch.widthM / 2,
      }
      const ordered = game.submitCommand({
        commandId:'postgoal-physical-position-'+seed,
        type:'setMovementTarget',teamId:kicker.clubId,
        playerId:kicker.playerId,target:centre,
      })
      expect(ordered.accepted).toBe(true)
      game.advance(110)
      const moved = game.getState()
      const actor = moved.players.find(p =>
        p.playerId===kicker.playerId)!
      const range = Math.hypot(actor.position.xM-centre.xM,
        actor.position.yM-centre.yM)
      expect(range).toBeLessThan(.9)
      expect(game.submitCommand({
        commandId:'real-physical-goal-attempt-'+seed,
        type:'attemptKick',teamId:kicker.clubId,
        playerId:kicker.playerId,
        target:{xM:fixture.pitch.lengthM,yM:centre.yM},
        power:1,lift:0,
      }).accepted).toBe(true)
      game.advance(1)
      const physical = game.getState()
      const strike = physical.contactEvents.at(-1)
      expect(strike?.outcome).toBe('kicked')
      expect(physical.ball.velocity.xMps).toBeGreaterThan(10)
      game.advance(140)
      const scored = game.getState()
      samples.push({
        seed,movedToBall:Number(range.toFixed(2)),
        kicked:strike?.outcome ?? null,
        goals:scored.goalEvents.length,postGoalComplete:false,
      })
      if (!scored.goalEvents.length) continue
      expect(scored.teams.map(t => t.score)).toEqual([1,0])
      expect(scored.postGoalKickoff?.teamId).toBe(fixture.clubs[1].id)
      expect(scored.ball.position).toEqual(centre)
      expect(scored.ball.controllerId).toBeNull()
      // The exact authoritative checkpoint includes a genuine prior kick.
      // An invented goal without contact would not restore successfully.
      const stagedCopy = restoreFoundationMatch(game.checkpoint())
      expect(stagedCopy.checkpoint()).toEqual(game.checkpoint())

      for (const club of fixture.clubs) {
        const command={
          commandId:'activate-after-goal-'+club.id,
          type:'setAutonomousTeam' as const,
          teamId:club.id,enabled:true,
        }
        expect(game.submitCommand(command).accepted).toBe(true)
        expect(stagedCopy.submitCommand(command).accepted).toBe(true)
      }
      for(let i=0;i<500;i++){
        game.advance(8)
        stagedCopy.advance(8)
        const now=game.getState()
        const finished=now.contactEvents.some(e=>
          e.commandId.startsWith('ai-pass-postgoal-') &&
          e.outcome==='kicked') &&
          now.postGoalKickoff===null
        if (finished) break
      }
      const continued=game.getState()
      expect(continued.contactEvents.some(e=>
        e.commandId.startsWith('ai-pass-postgoal-') &&
        e.outcome==='kicked')).toBe(true)
      expect(continued.postGoalKickoff).toBeNull()
      expect(continued.goalEvents.length).toBeGreaterThanOrEqual(1)
      expect(continued.teams[0].score).toBeGreaterThanOrEqual(1)
      expect(stagedCopy.checkpoint()).toEqual(game.checkpoint())
      const reopened=restoreFoundationMatch(game.checkpoint())
      expect(reopened.getState()).toEqual(continued)
      game.advance(8)
      reopened.advance(8)
      expect(reopened.checkpoint()).toEqual(game.checkpoint())
      samples[samples.length-1].postGoalComplete=true
      complete=true
      break
    }
    console.info('[O11 S1.4 PHYSICAL GOAL RESTART]', JSON.stringify(samples))
    expect(complete).toBe(true)
  }, 20000)
})
