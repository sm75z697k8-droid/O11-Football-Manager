import { FIRST_TEAM_SHEET } from './first-team'
import type { PlayerId } from '../game/model/player'
import type { Point2 } from '../game/model/pitch'
import type {
  Formation433Slot, PlayerDuty, PlayerRole,
} from '../game/model/team'

/**
 * Static lineup preview, intentionally independent of match simulation.
 *
 * The existing playable fixture/AI contracts still support 4-3-3 only.
 * This display puts the same eleven player IDs on the LEFT half of the
 * pitch in a real 4-2-3-1, without pretending the match engine already
 * supports a second tactical formation.
 */
export const FIRST_TEAM_PREVIEW_FORMATION = '4-2-3-1' as const

export const FORMATION_4231_SLOTS = [
  'GK', 'RB', 'RCB', 'LCB', 'LB', 'RDM', 'LDM', 'RW', 'CAM', 'LW', 'ST',
] as const
export type Formation4231Slot = (typeof FORMATION_4231_SLOTS)[number]

/** All centres, including the striker, are before the halfway line (52.5m). */
export const FIRST_TEAM_4231_POSITIONS: Readonly<Record<Formation4231Slot, Point2>> = {
  GK: { xM: 8, yM: 34 },
  RB: { xM: 18, yM: 57 },
  RCB: { xM: 18, yM: 42 },
  LCB: { xM: 18, yM: 26 },
  LB: { xM: 18, yM: 11 },
  RDM: { xM: 28, yM: 43 },
  LDM: { xM: 28, yM: 25 },
  RW: { xM: 38, yM: 56 },
  CAM: { xM: 38, yM: 34 },
  LW: { xM: 38, yM: 12 },
  ST: { xM: 47, yM: 34 },
}

/** Maps EXISTING player assignments into new display slots. No player edits. */
const PREVIEW_LAYOUT: Readonly<Record<Formation433Slot, {
  readonly slot: Formation4231Slot
  readonly role?: PlayerRole
  readonly duty?: PlayerDuty
}>> = {
  GK: { slot: 'GK' },
  RB: { slot: 'RB' },
  RCB: { slot: 'RCB' },
  LCB: { slot: 'LCB' },
  LB: { slot: 'LB' },
  DM: { slot: 'RDM', role: 'holdingMidfielder' },
  RCM: { slot: 'LDM', role: 'holdingMidfielder', duty: 'support' },
  LCM: { slot: 'CAM', role: 'attackingMidfielder', duty: 'support' },
  RW: { slot: 'RW' },
  ST: { slot: 'ST' },
  LW: { slot: 'LW' },
}

export interface FirstTeamPreviewAssignment {
  readonly playerId: PlayerId
  readonly shirtNumber: number
  readonly slot: Formation4231Slot
  readonly role: PlayerRole
  readonly duty: PlayerDuty
  readonly position: Point2
  /** This is the player's unchanged legacy engine assignment. */
  readonly engineSlot: Formation433Slot
}

export const FIRST_TEAM_4231_ASSIGNMENTS: readonly FirstTeamPreviewAssignment[] =
  FIRST_TEAM_SHEET.starters.map(starter => {
    const preview = PREVIEW_LAYOUT[starter.slot]
    return {
      playerId: starter.playerId,
      shirtNumber: starter.shirtNumber,
      slot: preview.slot,
      role: preview.role ?? starter.role,
      duty: preview.duty ?? starter.duty,
      position: FIRST_TEAM_4231_POSITIONS[preview.slot],
      engineSlot: starter.slot,
    }
  })

if (FIRST_TEAM_4231_ASSIGNMENTS.length !== 11 ||
  new Set(FIRST_TEAM_4231_ASSIGNMENTS.map(s => s.slot)).size !== 11) {
  throw new Error('First team must contain exactly eleven unique 4-2-3-1 lineup slots')
}
