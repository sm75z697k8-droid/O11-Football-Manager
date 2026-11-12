import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'

interface PassRecord {
  id: string
  seed: number
  receiver: string
  passer: string
  teamId: string
  releaseTick: number
  distance: number
  minReceiverM: number
  intended: {xM:number;yM:number}
  receiverAtRelease: {xM:number;yM:number}
  ownerFacing: number
  outcome: string
  finished: boolean
}
describe('Physical pass completion baseline — observed match flow', () => {
  it('records real receiver contact outcomes in seeded matches', () => {
    const records: PassRecord[] = []
    const snapshots: string[] = []
    for(const seed of [123456789,42,90,117,205,832,4100,9999,7654321]) {
      const session=new MatchViewerSession(seed)
      const pending=new Map<string,PassRecord>()
      const known=new Set<string>()
      for(let i=0;i<1100 && !session.state.ball.outsidePitch;i++) {
        session.advance(1)
        const s=session.state
        const intent=s.ai.passIntent
        if(intent && !known.has(intent.commandId)) {
          const command=s.pendingCommands.find(c=>c.commandId===intent.commandId)
          if(command?.type==='attemptKick') {
            const owner=s.players.find(p=>p.playerId===intent.passerId)!
            const rec:PassRecord={
              id:intent.commandId, seed, receiver:intent.receiverId,
              passer:intent.passerId, teamId:intent.teamId,
              releaseTick:-1, distance:Math.hypot(
                owner.position.xM-command.target.xM,
                owner.position.yM-command.target.yM),
              minReceiverM:99,intended:command.target,
              receiverAtRelease:s.players.find(p=>p.playerId===intent.receiverId)!.position,
              ownerFacing:owner.orientationRad,
              outcome:'pending',finished:false,
            }
            records.push(rec);pending.set(rec.id,rec);known.add(rec.id)
          }
        }
        for(const e of s.contactEvents.filter(e=>e.tick===s.clock.tick && e.commandId.startsWith('ai-pass-'))) {
          const r=pending.get(e.commandId)
          if(!r) continue
          if(e.outcome!=='kicked'){r.outcome=e.outcome;r.finished=true;continue}
          r.outcome='inFlight';r.releaseTick=s.clock.tick
        }
        for(const r of pending.values()) {
          if(r.finished || r.releaseTick<0)continue
          const receiver=s.players.find(p=>p.playerId===r.receiver)!
          r.minReceiverM=Math.min(r.minReceiverM,
            Math.hypot(receiver.position.xM-s.ball.position.xM,
              receiver.position.yM-s.ball.position.yM))
          if(s.ball.controllerId===r.receiver){r.finished=true;r.outcome='receiverControl'}
          else if(s.ball.controllerId && s.ball.controllerId!==r.passer){
            r.finished=true;r.outcome=s.ball.controllerId===r.receiver?'receiverControl':'otherControl'
          }
          else if(s.ball.lastTouchPlayerId!==r.passer &&
              s.ball.lastTouchPlayerId!==null){
            r.finished=true;r.outcome=s.ball.lastTouchPlayerId===r.receiver?'receiverTouch':'otherTouch'
          }else if(s.clock.tick-r.releaseTick>76 || s.ball.outsidePitch){
            r.finished=true;r.outcome=s.ball.outsidePitch?'outOfPlay':'timeout'
          }
        }
      }
      snapshots.push(JSON.stringify({
        seed,ticks:session.state.clock.tick,ballOut:session.state.ball.outsidePitch,
        attempted:[...records].filter(r=>r.seed===seed).length,
      }))
    }
    const finished=records.filter(r=>r.releaseTick>=0)
    const actual=finished.filter(r=>r.outcome==='receiverControl')
    const touched=finished.filter(r=>r.outcome==='receiverControl'||r.outcome==='receiverTouch')
    const byOutcome=Object.fromEntries([...new Set(finished.map(r=>r.outcome))].map(outcome=>[
      outcome,finished.filter(r=>r.outcome===outcome).length,
    ]))
    console.info('[O11 PASS CONNECTION BASELINE]',JSON.stringify({
      sampledMatches:snapshots.map(x=>JSON.parse(x)),
      kicked:finished.length,received:actual.length,touched:touched.length,
      outcomeCounts:byOutcome,
      avoidableMisses:finished.filter(r=>r.outcome!=='receiverControl')
        .slice(0,18).map(r=>({
          seed:r.seed,passMetres:+r.distance.toFixed(1),
          minGap:+r.minReceiverM.toFixed(2),outcome:r.outcome,
          intended:r.intended,receiver:r.receiverAtRelease,
          facingDeg:+(r.ownerFacing*180/Math.PI).toFixed(0),
        })),
      samples:finished.slice(0,16).map(r=>({
        seed:r.seed,passMetres:+r.distance.toFixed(1),
        minReceiverMetres:+r.minReceiverM.toFixed(2),outcome:r.outcome,
      })),
    }))
    expect(records.length).toBeGreaterThan(8)
    expect(finished.length).toBeGreaterThan(5)
    // Long-form multi-seed integration gate: track the ACTUAL designated
    // receiving footballer, not a cosmetic pass animation or a score roll.
    // It is a simulation regression threshold, NOT a real-world calibration.
    expect(actual.length / finished.length).toBeGreaterThan(0.80)
  })
})
