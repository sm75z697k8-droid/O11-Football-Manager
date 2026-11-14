import { describe, expect, it } from 'vitest'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import {
  defensiveRecoveryTarget, planDefensiveResponsibilities,
} from '../../src/game/ai/defensive-shape'
import {
  individualDefensiveRecovery,planIndividualDefensiveResponses,
} from '../../src/game/ai/defensive-individual'
import type { MatchState, PlayerMatchState } from '../../src/game/match/state'

function situation(side:0|1){
  const setup=makeFictionalMatchSetup()
  const base=createFoundationMatch(setup).getState()
  const team=base.teams[side]
  const foe=base.teams[1-side]
  const dir=team.attackingDirection
  const ball={xM:dir===1?39:66,yM:setup.pitch.widthM/2+5}
  const attackers=base.players.filter(p=>p.clubId===foe.clubId)
  const controller=attackers.find(p=>p.formationSlot==='RW')!
  const snapshot:MatchState={...base,
    ai:{...base.ai,enabledTeams:[true,true]},
    players:base.players.map(p=>p.playerId===controller.playerId
      ?{...p,position:{...ball},velocity:{
        xMps:-dir*2.4,yMps:.3}}
      :p),
    ball:{...base.ball,position:{...ball},controllerId:controller.playerId,
      controlOffset:{xM:0,yM:0},lastTouchPlayerId:controller.playerId},
  }
  const defending=snapshot.players.filter(p=>p.clubId===team.clubId)
  const blocks=new Map(defending.map(p=>{
    const anchor=snapshot.ai.formationPositions[p.playerId]
    return [p.playerId,defensiveRecoveryTarget(
      p,anchor,ball,team,setup)]
  }))
  const at=(slot:string)=>defending.find(p=>p.formationSlot===slot)!
  const cb=at('RCB'),fb=at('LB'),dm=at('DM'),cm=at('LCM')
  const where={
    ST:{xM:blocks.get(cb.playerId)!.xM+dir*3.2,
      yM:setup.pitch.widthM/2+2},
    LW:{xM:blocks.get(fb.playerId)!.xM+dir*3.8,
      yM:blocks.get(fb.playerId)!.yM+1.1},
    RCM:{xM:blocks.get(dm.playerId)!.xM+dir*3.6,
      yM:blocks.get(dm.playerId)!.yM+2.2},
  }
  const threatState:MatchState={...snapshot,
    players:snapshot.players.map(p=>
      p.clubId===foe.clubId &&p.formationSlot in where
        ?{...p,position:{...where[p.formationSlot as keyof typeof where]},
          velocity:{xMps:-dir*2.0,yMps:.55}}:p)}
  return {setup,team,foe,dir,ball,state:threatState,
    defending,cb,fb,dm,cm,blocks}
}

function plan(s:ReturnType<typeof situation>){
  return planDefensiveResponsibilities(
    s.state,s.setup,s.team,s.ball)
}

describe('DEF-F1: independent, coordinated defensive reasoning',()=>{
  for(const side of [0,1] as const){
    it(`keeps physically separate role decisions and unique threat markers on team ${side}`,()=>{
      const s=situation(side)
      const actions=plan(s)
      expect(actions.size).toBe(11)
      const choices=[...actions.entries()].filter(([,d])=>d.action==='mark')
      expect(choices.length).toBeGreaterThanOrEqual(1)
      expect(choices.length).toBeLessThanOrEqual(4)
      expect([...actions.values()].filter(a=>a.action==='cover'))
        .toHaveLength(1)
      const keeper=s.defending.find(p=>p.formationSlot==='GK')!
      expect(actions.get(keeper.playerId)).toMatchObject({
        action:'shape',engage:false})
      const engaging=[...actions.values()].filter(a=>a.engage)
      expect(engaging.length).toBeLessThanOrEqual(2)
      for(const p of s.defending){
        const action=actions.get(p.playerId)!
        expect(action).toBeDefined()
        expect(Number.isFinite(action.target.xM)).toBe(true)
        expect(Number.isFinite(action.target.yM)).toBe(true)
        expect(action.target.xM).toBeGreaterThanOrEqual(2.5)
        expect(action.target.yM).toBeLessThanOrEqual(s.setup.pitch.widthM-2.5)
        // Markers are intentionally moved by normal acceleration,
        // not attached to or teleported on top of the runner.
        if(action.action==='mark'){
          const block=s.blocks.get(p.playerId)!
          expect(Math.hypot(action.target.xM-block.xM,
            action.target.yM-block.yM)).toBeLessThanOrEqual(8.01)
          expect(action.engage).toBe(false)
        }
      }
      // Compare displacement from EACH player's defensive block, not
      // just their absolute original position: a copied uniform shift
      // would produce identical displacement vectors.
      const displacement=s.defending
        .filter(p=>p.formationSlot!=='GK')
        .map(p=>{
          const d=actions.get(p.playerId)!,b=s.blocks.get(p.playerId)!
          return [Math.round((d.target.xM-b.xM)*10)/10,
            Math.round((d.target.yM-b.yM)*10)/10].join(',')
        })
      expect(new Set(displacement).size).toBeGreaterThanOrEqual(4)
    })
    it(`assigns the dangerous central runner and wide channel to different suitable players on team ${side}`,()=>{
      const s=situation(side)
      const teammates=s.defending.filter(p=>['RCB','LCB','RB','LB',
        'DM','RCM','LCM','RW','LW','ST'].includes(p.formationSlot))
      const threats=s.state.players.filter(p=>p.clubId===s.foe.clubId &&
        ['ST','LW','RCM'].includes(p.formationSlot))
      const responses=planIndividualDefensiveResponses(
        s.state,s.setup,s.team,s.ball,teammates,threats,s.blocks)
      const used=[...responses.values()].filter(r=>r.action==='mark')
        .map(r=>r.threatPlayerId)
      expect(new Set(used).size).toBe(used.length)
      const matched=[...responses.entries()]
        .filter(([,r])=>r.action==='mark')
      expect(matched.length).toBeGreaterThanOrEqual(2)
      const byId=new Map(s.state.players.map(p=>[p.playerId,p]))
      const striker=matched.find(([,r])=>
        byId.get(r.threatPlayerId!)?.formationSlot==='ST')
      if(striker){
        const p=byId.get(striker[0])!
        expect(['RCB','LCB','DM','RCM','LCM']).toContain(p.formationSlot)
      }
      const fullback=matched.find(([,r])=>
        byId.get(r.threatPlayerId!)?.formationSlot==='LW')
      if(fullback){
        const p=byId.get(fullback[0])!
        expect(['LB','RB','LCM','RCM','LW','RW']).toContain(p.formationSlot)
      }
    })
    it(`lets the individual DM screen and wide/central roles respond differently on team ${side}`,()=>{
      const s=situation(side)
      const threats=s.state.players.filter(p=>p.clubId===s.foe.clubId &&
        ['ST','LW','RCM'].includes(p.formationSlot))
      const rec=(p:PlayerMatchState)=>
        individualDefensiveRecovery(s.state,s.setup,s.team,p,
          s.state.ai.formationPositions[p.playerId]!,
          s.blocks.get(p.playerId)!,s.ball,threats)
      const dm=rec(s.dm),fb=rec(s.fb),cb=rec(s.cb),cm=rec(s.cm)
      const block=(p:PlayerMatchState)=>s.blocks.get(p.playerId)!
      const shifts=[s.dm,s.fb,s.cb,s.cm].map((p,i)=>{
        const target=[dm,fb,cb,cm][i],b=block(p)
        return [+(target.xM-b.xM).toFixed(2),
          +(target.yM-b.yM).toFixed(2)].join(',')
      })
      expect(new Set(shifts).size).toBeGreaterThanOrEqual(3)
      expect([dm,fb,cb,cm].every(t=>t.xM>=2.5 &&
        t.xM<=s.setup.pitch.lengthM-2.5)).toBe(true)
    })
  }

  it('changes predictions and recovery intensity with personal positioning, anticipation and holding tendency',()=>{
    const s=situation(0)
    const player=s.dm
    const original=s.state.ai.formationPositions[player.playerId]
    const block=s.blocks.get(player.playerId)!
    const runner=s.state.players.find(p=>
      p.clubId===s.foe.clubId&&p.formationSlot==='RCM')!
    const threats=[runner]
    const modified=(rating:number,holds:boolean)=>{
      const players=s.setup.players.map(d=>
        d.id!==player.playerId?d:{
          ...d,tendencies:holds?['holdsPosition' as const]:[],
          abilities:{...d.abilities,
            mental:{...d.abilities.mental,defensivePositioning:rating,
              anticipation:rating,decisions:rating,teamwork:rating}},
        })
      return {...s.setup,players}
    }
    const bold=individualDefensiveRecovery(s.state,modified(97,false),
      s.team,player,original,block,s.ball,threats)
    const slow=individualDefensiveRecovery(s.state,modified(12,false),
      s.team,player,original,block,s.ball,threats)
    const holding=individualDefensiveRecovery(s.state,modified(97,true),
      s.team,player,original,block,s.ball,threats)
    const displacement=(p:typeof bold)=>Math.hypot(
      p.xM-block.xM,p.yM-block.yM)
    expect(displacement(bold)).toBeGreaterThan(displacement(slow))
    expect(displacement(holding)).toBeLessThan(displacement(bold))
    expect(s.state.players.find(p=>p.playerId===player.playerId))
      .toEqual(player)
  })

  it('replans promptly when a threatening runner moves, without creating fake challenges or completed tackles',()=>{
    const s=situation(0)
    const original=JSON.stringify(s.state)
    const first=plan(s)
    const threat=s.state.players.find(p=>p.clubId===s.foe.clubId &&
      p.formationSlot==='ST')!
    const modified:MatchState={...s.state,
      players:s.state.players.map(p=>p.playerId===threat.playerId
        ?{...p,position:{...p.position,yM:p.position.yM+6},
          velocity:{xMps:-s.dir*3,yMps:1.6}}:p)}
    const second=planDefensiveResponsibilities(modified,
      s.setup,s.team,s.ball)
    const same=[...first.entries()].every(([id,result])=>
      JSON.stringify(result)===JSON.stringify(second.get(id)))
    expect(same).toBe(false)
    expect(s.state.automaticContactEvents).toEqual([])
    expect(s.state.contactEvents).toEqual([])
    expect(JSON.stringify(s.state)).toBe(original)
  })

  it('passes a real seeded two-team defensive checkpoint through exact replay',()=>{
    const setup=makeFictionalMatchSetup()
    const engine=createFoundationMatch(setup)
    for(const team of setup.clubs){
      expect(engine.submitCommand({commandId:'individual-'+team.id,
        type:'setAutonomousTeam',teamId:team.id,enabled:true
      }).accepted).toBe(true)
    }
    engine.advance(580)
    const before=engine.checkpoint()
    const clone=restoreFoundationMatch(before)
    engine.advance(160)
    for(const n of [1,7,23,54,75])clone.advance(n)
    expect(clone.checkpoint()).toEqual(engine.checkpoint())
    expect(engine.getState().ai.enabledTeams).toEqual([true,true])
    expect(engine.getState().ai.decisionSnapshot).toHaveLength(22)
  },20_000)
})
