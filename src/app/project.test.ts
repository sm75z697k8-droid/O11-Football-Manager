import { describe, expect, it } from 'vitest'
import { ENGINE_STATUS, FOUNDATION_STAGES, PROJECT_NAME, PROJECT_PHASE } from './project'

describe('Project development status', () => {
  it('keeps the match engine clearly marked as landscape-first physical viewer', () => {
    expect(PROJECT_NAME).toBe('O11 Football Manager')
    expect(PROJECT_PHASE).toBe('6.3')
    expect(ENGINE_STATUS).toBe('coordinated-team-intelligence'
  })

  it('defines unique and sequential foundation milestones', () => {
    expect(FOUNDATION_STAGES.map((stage) => stage.id)).toEqual(['0A', '0B', '0C', '0D', '0E', '1', '2', '3', '4', '5', '6', '6.3'])
    expect(new Set(FOUNDATION_STAGES.map((stage) => stage.id)).size).toBe(FOUNDATION_STAGES.length)
  })
})
