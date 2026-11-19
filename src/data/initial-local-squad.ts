import { FIRST_TEAM } from './first-team'
import {
  FIRST_TEAM_4231_ASSIGNMENTS, FIRST_TEAM_PREVIEW_FORMATION,
} from './first-team-lineup'
import type { LocalSquadSeed } from '../storage/local-squad'

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
