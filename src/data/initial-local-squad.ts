import { FIRST_TEAM } from './first-team'
import {
  FIRST_TEAM_4231_ASSIGNMENTS, FIRST_TEAM_PREVIEW_FORMATION,
} from './first-team-lineup'
import type { LocalSquadSeed, KnownPlayerReplacement, KnownRosterUpdate } from '../storage/local-squad'

/** GitHub-bundled test-data baseline. IndexedDB inserts it ONCE per device. */
export const INITIAL_LOCAL_SQUAD = {
  schemaVersion: 1,
  clubId: FIRST_TEAM.club.id,
  club: FIRST_TEAM.club,
  players: FIRST_TEAM.players,
  engineSheet: FIRST_TEAM.sheet,
  lineupPreview: {
    formation: FIRST_TEAM_PREVIEW_FORMATION,
    starters: FIRST_TEAM_4231_ASSIGNMENTS,
  },
} satisfies LocalSquadSeed

/** Explicit migration of only the former fictional CAM, on existing iPhones. */
export const BRUNO_REPLACEMENT: KnownPlayerReplacement = {
  previousId: 'harbor_senior_10',
  previousFullName: 'Rafiq Idris',
  replacementId: '43124203',
}

/** Upgrade existing saved XI without touching other nine players or their edits. */
export const MAN_UTD_SESKO_UPDATE = {
  replacements: [
    { ...BRUNO_REPLACEMENT, previousShirtNumber: 10, expectedSlot: 'LCM' },
    {
      previousId: 'harbor_senior_09',
      previousFullName: 'Karim Haddad',
      replacementId: '62246208',
      previousShirtNumber: 9,
      expectedSlot: 'ST',
    },
  ],
  numberChanges: [
    { playerId: 'harbor_senior_08', from: 8, to: 10 },
    { playerId: '43124203', from: 10, to: 8 },
    { playerId: '62246208', from: 9, to: 30 },
  ],
} satisfies KnownRosterUpdate

/**
 * Add real goalkeeper #1 while retaining the two earlier player imports.
 * On existing Bruno+Šeško saves, their shirt numbers are NOT re-migrated,
 * protecting any intentional later edits. New/older squads get all three.
 */
export const MAN_UTD_LAMMENS_UPDATE = {
  replacements: [
    ...MAN_UTD_SESKO_UPDATE.replacements,
    {
      previousId: 'harbor_senior_01',
      previousFullName: 'Samir Rahman',
      replacementId: '18107436',
      previousShirtNumber: 1,
      expectedSlot: 'GK',
    },
  ],
  numberChanges: MAN_UTD_SESKO_UPDATE.numberChanges,
  numberChangesOnlyIfMissingPlayerIds: ['43124203', '62246208'],
} satisfies KnownRosterUpdate
