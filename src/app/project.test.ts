import { describe, expect, it } from 'vitest'
import { ENGINE_STATUS, FOUNDATION_STAGES, PROJECT_NAME, PROJECT_PHASE } from './project'

describe('Project development status', () => {
  it('keeps the match engine clearly marked as landscape-first physical viewer', () => {
    expect(PROJECT_NAME).toBe('O11 Football Manager')
    expect(PROJECT_PHASE).toBe('BOX-F1')
    expect(ENGINE_STATUS).toBe('physical-post-kick-separation-box-f1')
  })

  it('defines unique and sequential foundation milestones', () => {
    expect(FOUNDATION_STAGES.map((stage) => stage.id)).toEqual(['0A', '0B', '0C', '0D', '0E', '1', '2', '3', '4', '5', '6', '6.3', '6.3.1', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9A', '6.9B', '6.9D', '6.9E', '6.9F', '6.9G', '6.9H', '6.9I', '6.9J', '6.9K', '6.9L', '6.9M', '6.9N', '6.9O', '6.9P', '6.9Q', '6.9R', '6.9S', '6.9T', 'S1.1', 'S1.2', 'S1.3', 'S1.4', 'S1.5', 'S1.6', 'S1.7', 'S1.7.1', 'ATT-S1', 'GK-S1', 'ATT-F1', 'PHY-F1', 'COR-S1', 'BOX-F1'])
    expect(new Set(FOUNDATION_STAGES.map((stage) => stage.id)).size).toBe(FOUNDATION_STAGES.length)
  })
})
