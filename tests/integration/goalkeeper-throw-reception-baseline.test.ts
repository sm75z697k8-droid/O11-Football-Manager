import { describe, expect, it } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'

interface ActualThrow {
  readonly seed: number
  readonly commandId: string
  readonly keeperId: string
  readonly receiverId: string
  readonly distanceM: number
  readonly proposedPower: number
  releasedTick: number
  completed: boolean
  outcome: 'pending' | 'throwFailed' | 'receiverControl' |
    'receiverTouch' | 'otherControl' | 'otherTouch' | 'outOfPlay' | 'timeout'
}

/**
 * Real outgoing throws in the same headless exhibition as the ball/contact
 * benchmarks. These metrics do NOT award or assume successful reception.
 * Report actual touch/first-control outcomes separately from candidate scores.
 */
describe('Physical goalkeeper throw-to-receiver diagnostic', () => {
  it('observes genuine launched throws and resulting physical touches', () => {
    const records: ActualThrow[] = []
    for (const seed of [123456789,42,90,117,205,832,4100,9999,7654321]) {
      const session = new MatchViewerSession(seed)
      const known = new Map<string, ActualThrow>()
      for (let i=0;i<1600 &&
          !session.state.ball.outsidePitch &&
          session.state.goalEvents.length===0;i+=1) {
        session.advance(1)
        const s=session.state
        const intent=s.ai.passIntent
        if (intent?.commandId.startsWith('ai-pass-throw-') &&
            !known.has(intent.commandId)) {
          const scheduled=s.pendingCommands.find(c=>
            c.commandId===intent.commandId)
          const keeper=s.players.find(p=>p.playerId===intent.passerId)
          if (scheduled?.type==='attemptGoalkeeperThrow'&&keeper) {
            const distanceM=Math.hypot(
              scheduled.target.xM-keeper.position.xM,
              scheduled.target.yM-keeper.position.yM)
            const record:ActualThrow={
              seed,commandId:intent.commandId,
              keeperId:intent.passerId,receiverId:intent.receiverId,
              distanceM,proposedPower:scheduled.power,
              releasedTick:-1,completed:false,outcome:'pending',
            }
            known.set(record.commandId,record)
            records.push(record)
          }
        }
        for (const event of s.contactEvents.filter(e=>
          e.tick===s.clock.tick&&e.kind==='throw')) {
          const record=known.get(event.commandId)
          if (!record) continue
          if (event.outcome==='thrown')record.releasedTick=event.tick
          else{record.outcome='throwFailed';record.completed=true}
        }
        for (const record of known.values()) {
          if (record.completed||record.releasedTick<0)continue
          if (s.ball.controllerId===record.receiverId) {
            record.completed=true;record.outcome='receiverControl'
          } else if (s.ball.controllerId &&
              s.ball.controllerId!==record.keeperId) {
            record.completed=true;record.outcome='otherControl'
          } else if (s.ball.lastTouchPlayerId!==record.keeperId &&
              s.ball.lastTouchPlayerId!==null) {
            record.completed=true
            record.outcome=s.ball.lastTouchPlayerId===record.receiverId
              ? 'receiverTouch':'otherTouch'
          } else if (s.ball.outsidePitch || s.clock.tick-record.releasedTick>90) {
            record.completed=true
            record.outcome=s.ball.outsidePitch?'outOfPlay':'timeout'
          }
        }
      }
    }
    const actual=records.filter(r=>r.releasedTick>=0)
    const control=actual.filter(r=>r.outcome==='receiverControl')
    console.info('[O11 GK PHYSICAL THROW RECEPTION]',JSON.stringify({
      source:'actual fictional seeded exhibitions, NOT iPhone Safari',
      seeds:9,attempts:records.length,realThrows:actual.length,
      intendedReceiverControls:control.length,
      outcomeCounts:Object.fromEntries(
        [...new Set(actual.map(x=>x.outcome))].map(k=>[
          k,actual.filter(x=>x.outcome===k).length])),
      individual:actual.map(r=>({
        seed:r.seed,metres:+r.distanceM.toFixed(1),
        power:+r.proposedPower.toFixed(2),
        tick:r.releasedTick,outcome:r.outcome,
      })),
    }))
    // This is an observational nine-seed sample, NOT a guaranteed count.
    // The separate swept-catch and physical-throw tests check both ends.
    expect(actual.length).toBeGreaterThan(0)
    expect(actual.every(r=>r.proposedPower>=0&&r.proposedPower<=1)).toBe(true)
    expect(actual.every(r=>r.receiverId!==r.keeperId)).toBe(true)
    // Never claim the nominal preview is a guaranteed successful throw.
    expect(control.length).toBeLessThanOrEqual(actual.length)
  },30000)
})
