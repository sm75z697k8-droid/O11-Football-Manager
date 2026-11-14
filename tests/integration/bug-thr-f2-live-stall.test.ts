import { describe, it, expect } from 'vitest'
import { MatchViewerSession } from '../../src/game/viewer/session'
import { restoreFoundationMatch } from '../../src/game/match/engine'

/**
 * The original iPhone seed EFAD5103 reported a 3,724-tick unfinished Vale
 * throw-in, but its abbreviated match report lacks player position and build
 * revision. Replaying the current code diverges well before that incident.
 * This is a transparent LONG-RUN CONTINUITY regression on the supplied
 * seed/preset, NOT a claim to have reconstructed the original throw-in.
 */
describe('THR-F2 — live EFAD5103 match restart continuity', () => {
  it('never stalls in a throw-in and still supports a late real checkpoint', () => {
    const s=new MatchViewerSession(0xEFAD5103,'keeper-comparison')
    let longestThrowInTicks=0
    let throwInTicksSeen=0
    while(s.state.clock.tick<42108){
      s.advance(Math.min(8,42108-s.state.clock.tick))
      const st=s.state
      if(st.restart?.kind==='throwIn'){
        const elapsed=st.clock.tick-st.restart.tick
        longestThrowInTicks=Math.max(longestThrowInTicks,elapsed)
        throwInTicksSeen+=1
        // Fifty simulated seconds at the touchline is already far beyond
        // normal legal preparation. Never allow a three-minute deadlock.
        expect(elapsed).toBeLessThan(1000)
      }
      if(st.period==='fullTime'||st.period==='halfTime')break
    }
    expect(s.state.clock.tick).toBe(42108)
    expect(s.state.ai.enabledTeams).toEqual([true,true])
    expect(s.state.outOfPlayEvents.some(e=>e.kind==='throwIn')).toBe(true)
    expect(s.state.contactEvents.some(e=>e.outcome==='thrownIn')).toBe(true)
    // This assertion would fail if the physical simulation were left in
    // the user's reported 186s stuck restart at this checkpoint.
    expect(s.state.restart?.kind).not.toBe('throwIn')
    expect(longestThrowInTicks).toBeLessThan(1000)
    expect(throwInTicksSeen).toBeGreaterThan(0)
    const restored=restoreFoundationMatch(s.checkpoint())
    for(let i=0;i<12;i++){
      s.advance(1)
      restored.advance(1)
      expect(restored.checkpoint()).toEqual(s.checkpoint())
    }
  },240_000)
})
