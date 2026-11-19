import type { LocalSquadSeed } from '../storage/local-squad'
import type { PlayerDefinition } from '../game/model/player'
import type { FirstTeamPreviewAssignment } from './first-team-lineup'

/**
 * Pure data selector: every displayed player, number, role and position must
 * come from the ACTIVE squad snapshot (IndexedDB when available).
 * No hardcoded FIRST_TEAM lookup may be used to draw or inspect this lineup.
 */
export interface PreviewSquadMember {
  readonly player: PlayerDefinition
  readonly assignment: FirstTeamPreviewAssignment
}

export function selectPreviewSquadMembers(squad: LocalSquadSeed): readonly PreviewSquadMember[] {
  const players = new Map(squad.players.map(player => [player.id, player]))
  return squad.lineupPreview.starters.map(assignment => {
    const player = players.get(assignment.playerId)
    if (!player) throw new Error('Player missing from active squad: ' + assignment.playerId)
    return { player, assignment }
  })
}
