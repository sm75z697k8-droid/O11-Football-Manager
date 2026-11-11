import { describe, expect, it } from 'vitest'
import { FoundationMatchEngine } from '../../src/game/match/engine'
import { MAX_COMMANDS_PER_MATCH } from '../../src/game/match/commands'
import { makeFictionalMatchSetup } from '../fixtures/fictional-match'

const create = () => FoundationMatchEngine.create(makeFictionalMatchSetup())

describe('deterministic tactical command scheduling', () => {
  it('queues a valid command for the next tick, with an ordered receipt', () => {
    const engine = create()
    const ack = engine.submitCommand({
      commandId: 'instruction-1', teamId: 'club_harbor',
      type: 'setPressingIntensity', intensity: 'high',
    })
    expect(ack).toEqual({
      accepted: true, commandId: 'instruction-1', targetTick: 1, sequence: 1,
    })
    expect(engine.getState().teams[0].pressingIntensity).toBe('standard')
    expect(engine.getState().pendingCommands).toHaveLength(1)
    engine.advance()
    expect(engine.getState().teams[0].pressingIntensity).toBe('high')
    expect(engine.getState().pendingCommands).toHaveLength(0)
    expect(engine.getState().appliedCommands[0].appliedTick).toBe(1)
  })

  it('applies same-tick commands in stable submission order', () => {
    const engine = create()
    for (const [commandId, intensity] of [
      ['a', 'low'], ['b', 'high'], ['c', 'standard'],
    ] as const) {
      expect(engine.submitCommand({
        commandId, teamId: 'club_harbor', type: 'setPressingIntensity', intensity,
      }).accepted).toBe(true)
    }
    engine.advance()
    const state = engine.getState()
    expect(state.appliedCommands.map((command) => command.commandId)).toEqual(['a', 'b', 'c'])
    expect(state.teams[0].pressingIntensity).toBe('standard')
    expect(state.appliedCommands.every((command) => command.appliedTick === 1)).toBe(true)
  })

  it('schedules after the current tick without changing prior outcomes', () => {
    const engine = create()
    engine.advance(23)
    const receipt = engine.submitCommand({
      commandId: 'next-step', teamId: 'club_vale', type: 'setPressingIntensity', intensity: 'low',
    })
    expect(receipt.accepted && receipt.targetTick).toBe(24)
    expect(engine.getState().teams[1].pressingIntensity).toBe('standard')
    engine.advance()
    expect(engine.getState().teams[1].pressingIntensity).toBe('low')
  })

  it('rejects unknown teams, duplicate IDs, invalid intensities and unsupported commands', () => {
    const engine = create()
    const valid = { commandId: 'first', teamId: 'club_harbor', type: 'setPressingIntensity', intensity: 'high' }
    expect(engine.submitCommand(valid).accepted).toBe(true)
    const before = engine.getState()
    const bad = [
      valid,
      { ...valid, commandId: 'unknown', teamId: 'not_a_team' },
      { ...valid, commandId: 'invalid', intensity: 'extreme' },
      { ...valid, commandId: 'unsupported', type: 'scoreGoal' },
      { ...valid, commandId: 'extra', debug: true },
      { ...valid, commandId: '' },
      null,
    ]
    for (const command of bad) expect(engine.submitCommand(command).accepted).toBe(false)
    expect(engine.getState()).toEqual(before)
  })

  it('limits command history, including commands already applied', () => {
    const engine = create()
    for (let i = 0; i < MAX_COMMANDS_PER_MATCH; i++) {
      expect(engine.submitCommand({
        commandId: 'id-' + i, teamId: 'club_harbor',
        type: 'setPressingIntensity', intensity: 'high',
      }).accepted).toBe(true)
    }
    engine.advance()
    expect(engine.getState().appliedCommands).toHaveLength(MAX_COMMANDS_PER_MATCH)
    expect(engine.submitCommand({
      commandId: 'overflow', teamId: 'club_harbor',
      type: 'setPressingIntensity', intensity: 'low',
    }).accepted).toBe(false)
  })
})
