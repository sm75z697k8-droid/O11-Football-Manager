import { describe, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { activePhysicalShot } from '../../src/game/ai/goal-directed'
import { goalkeeperSaveWindow } from '../../src/game/physics/goalkeeper-saves'

describe('Temporary goalkeeper live save diagnostic', () => {
  it('observes real candidate shots and actual keeper reach across seeds', () => {
    const seeds = [123456789,7654321,42,90,117,205,832,4100,9999,123,321,1111,2222,3333,55555,12345]
    const summaries = []
    for (const seed of seeds) {
      const session = new MatchViewerSession(seed)
      const seenShots = new Set<string>()
      const samples: unknown[] = []
      let near = 0
      let catches = 0
      let parries = 0
      for (let i = 0; i < 1400 &&
        !session.state.ball.outsidePitch &&
        !session.state.goalEvents.length; i++) {
        session.advance(1)
        const state = session.state
        const shot = activePhysicalShot(state)
        if (shot) {
          seenShots.add(shot.shooterId + ':' + shot.tick)
          const shooter = state.players.find(p=>p.playerId===shot.shooterId)
          const keeper = state.players.find(p=>p.clubId!==shooter?.clubId && p.formationSlot==='GK')
          if (keeper) {
            const dist = Math.hypot(state.ball.position.xM-keeper.position.xM,state.ball.position.yM-keeper.position.yM)
            const def = session.setup.players.find(p=>p.id===keeper.playerId)!
            const window = goalkeeperSaveWindow(def,state.clock.tick,shot.tick)
            if (dist < 2.2 && state.ball.position.xM >=0 && state.ball.position.xM<=session.setup.pitch.lengthM) {
              near++
              if(samples.length<15) samples.push({
                tick:state.clock.tick,age:state.clock.tick-shot.tick,
                dist:+dist.toFixed(2),height:+state.ball.heightM.toFixed(2),
                reach:+window.reachM.toFixed(2),engages:keeper.engagesBall,
                shotSpeed:+Math.hypot(state.ball.velocity.xMps,state.ball.velocity.yMps).toFixed(1),
                action:state.ai.decisionSnapshot.find(x=>x.playerId===keeper.playerId)?.action,
              })
            }
          }
        }
      }
      catches=session.state.automaticContactEvents.filter(e=>e.outcome==='caught').length
      parries=session.state.automaticContactEvents.filter(e=>e.outcome==='parried').length
      summaries.push({seed,shots:seenShots.size,near,catches,parries,samples})
    }
    console.log('GK LIVE RADIUS DIAGNOSTICS',JSON.stringify(summaries))
  })
})
