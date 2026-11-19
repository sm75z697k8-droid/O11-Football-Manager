import { FIRST_TEAM } from './first-team'
import {
  FIRST_TEAM_4231_ASSIGNMENTS, FIRST_TEAM_PREVIEW_FORMATION,
} from './first-team-lineup'
import type { LocalSquadSeed, KnownPlayerReplacement } from '../storage/local-squad'

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
