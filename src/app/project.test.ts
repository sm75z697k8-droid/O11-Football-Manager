import { describe, expect, it } from 'vitest'
import { ENGINE_STATUS, FOUNDATION_STAGES, PROJECT_NAME, PROJECT_PHASE } from './project'

describe('Phase 0A project foundation', () => {
  it('keeps the future simulation clearly marked as unimplemented', () => {
    expect(PROJECT_NAME).toBe('O11 Football Manager')
    expect(PROJECT_PHASE).toBe('0B')
    expect(ENGINE_STATUS).toBe('not-implemented')
  })

  it('defines unique and sequential foundation milestones', () => {
    expect(FOUNDATION_STAGES.map((stage) => stage.id)).toEqual(['0A', '0B', '0C', '0D', '0E'])
    expect(new Set(FOUNDATION_STAGES.map((stage) => stage.id)).size).toBe(FOUNDATION_STAGES.length)
  })
})
