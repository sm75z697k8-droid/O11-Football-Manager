import { describe, expect, it } from 'vitest'
import { createFoundationMatch, restoreFoundationMatch } from '../../src/game/match/engine'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

type RecordedInput = {
  commandId: string
  teamId: string
  type: 'setPressingIntensity'
  intensity: 'low' | 'standard' | 'high'
}

const commands: { tick: number; instruction: RecordedInput }[] = [
  { tick: 0, instruction: { commandId: 'a', teamId: 'club_harbor', type: 'setPressingIntensity', intensity: 'high' } },
  { tick: 10, instruction: { commandId: 'b', teamId: 'club_vale', type: 'setPressingIntensity', intensity: 'low' } },
  { tick: 10, instruction: { commandId: 'c', teamId: 'club_harbor', type: 'setPressingIntensity', intensity: 'standard' } },
  { tick: 250, instruction: { commandId: 'd', teamId: 'club_vale', type: 'setPressingIntensity', intensity: 'high' } },
]

function run(chunks: readonly number[]) {
  const engine = createFoundationMatch(makeFictionalMatchSetup())
  for (const { tick, instruction } of commands) {
    const delta = tick - engine.getState().clock.tick
    if (delta > 0) engine.advance(delta)
    expect(engine.submitCommand(instruction).accepted).toBe(true)
  }
  for (const count of chunks) engine.advance(count)
  return engine.checkpoint()
}

describe('match-state replay guarantees under the same engine version', () => {
  it('reproduces commands and state exactly for identical inputs', () => {
    const first = run([750, 1000, 1250])
    const second = run([750, 1000, 1250])
    expect(second).toEqual(first)
    expect(first.state.clock.tick).toBe(3250)
    expect(first.state.appliedCommands.map((c) => c.commandId)).toEqual(['a', 'b', 'c', 'd'])
    expect(first.state.teams.map((team) => team.pressingIntensity)).toEqual(['standard', 'high'])
  })

  it('is invariant to different tick chunk sizes (the UI controls pacing only)', () => {
    const a = run([3000])
    const b = run([1, 29, 70, 100, 800, 2000])
    expect(a).toEqual(b)
  })

  it('checkpoint/resume is bitwise-identical at the serialized state level', () => {
    const engine = createFoundationMatch(makeFictionalMatchSetup())
    engine.submitCommand({
      commandId: 'queued', teamId: 'club_harbor',
      type: 'setPressingIntensity', intensity: 'low',
    })
    const checkpoint = JSON.parse(JSON.stringify(engine.checkpoint()))
    const restored = restoreFoundationMatch(checkpoint)
    engine.advance(9800)
    restored.advance(3600)
    restored.advance(6200)
    expect(restored.checkpoint()).toEqual(engine.checkpoint())
  })
})
