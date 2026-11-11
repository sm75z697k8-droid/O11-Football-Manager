import { describe, expect, it } from 'vitest'
import { ENGINE_STATUS, FOUNDATION_STAGES, PROJECT_NAME, PROJECT_PHASE } from './project'

describe('Phase 0A project foundation', () => {
  it('keeps the match engine clearly marked as foundation-only', () => {
    expect(PROJECT_NAME).toBe('O11 Football Manager')
    expect(PROJECT_PHASE).toBe('0E')
    expect(ENGINE_STATUS).toBe('foundation-only')
  })

  it('defines unique and sequential foundation milestones', () => {
    expect(FOUNDATION_STAGES.map((stage) => stage.id)).toEqual(['0A', '0B', '0C', '0D', '0E'])
    expect(new Set(FOUNDATION_STAGES.map((stage) => stage.id)).size).toBe(FOUNDATION_STAGES.length)
  })
})
