import {
  GOALKEEPING_ATTRIBUTES, HIDDEN_CHARACTERISTICS, MENTAL_ATTRIBUTES,
  PHYSICAL_ATTRIBUTES, TECHNICAL_ATTRIBUTES,
} from '../../src/game/model/attributes'
import { MATCH_SETUP_VERSION } from '../../src/game/model/match'
import type { MatchSetup } from '../../src/game/model/match'
import type { PlayerDefinition } from '../../src/game/model/player'
import { DEFAULT_PITCH } from '../../src/game/model/pitch'
import { AVAILABLE_ROLES_BY_SLOT, FORMATION_433_SLOTS } from '../../src/game/model/team'
import type { ClubDefinition, Formation433Slot, PlayerDuty, StartingAssignment, TeamSheet } from '../../src/game/model/team'

function ratings<K extends string>(keys: readonly K[], score: number): Readonly<Record<K, number>> {
  return Object.fromEntries(keys.map((key) => [key, score])) as Record<K, number>
}

function makePlayer(clubId: string, prefix: string, slot: Formation433Slot, index: number): PlayerDefinition {
  return {
    id: prefix + '_player_' + String(index + 1).padStart(2, '0'),
    clubId,
    profile: {
      fullName: (prefix === 'harbor' ? 'Harbor' : 'Vale') + ' Player ' + (index + 1),
      dateOfBirth: '2001-02-14',
      heightCm: 178 + (index % 9),
      massKg: 72 + (index % 11),
      preferredFoot: index % 3 === 0 ? 'left' : 'right',
      weakerFoot: 38 + (index % 20),
    },
    abilities: {
      technical: ratings(TECHNICAL_ATTRIBUTES, 54 + (index % 12)),
      mental: ratings(MENTAL_ATTRIBUTES, 49 + (index % 15)),
      physical: ratings(PHYSICAL_ATTRIBUTES, 55 + (index % 11)),
      goalkeeping: slot === 'GK' ? ratings(GOALKEEPING_ATTRIBUTES, 68) : null,
    },
    hidden: ratings(HIDDEN_CHARACTERISTICS, 50 + (index % 10)),
    positionFamiliarity: { [slot]: 80 },
    tendencies: [],
  }
}

function makeTeam(club: ClubDefinition, prefix: string): { team: TeamSheet; players: PlayerDefinition[] } {
  const players = FORMATION_433_SLOTS.map((slot, index) => makePlayer(club.id, prefix, slot, index))
  const starters: StartingAssignment[] = FORMATION_433_SLOTS.map((slot, index) => {
    const duty: PlayerDuty = slot === 'ST' || slot === 'LW' || slot === 'RW'
      ? 'attack' : slot === 'RCM' || slot === 'LCM' ? 'support' : 'defend'
    return {
      playerId: players[index].id,
      slot,
      role: AVAILABLE_ROLES_BY_SLOT[slot][0],
      duty,
      shirtNumber: index + 1,
    }
  })
  return { team: { clubId: club.id, formation: '4-3-3', starters }, players }
}

/** Deliberately fictional test data; not real football records or a playable roster. */
export function makeFictionalMatchSetup(): MatchSetup {
  const harbor: ClubDefinition = {
    id: 'club_harbor', name: 'Harbor Athletic', shortName: 'HAR',
    colors: { primary: '#3A9CE8', secondary: '#E8F5FF' },
  }
  const vale: ClubDefinition = {
    id: 'club_vale', name: 'Vale Rovers', shortName: 'VAL',
    colors: { primary: '#E77A72', secondary: '#FFF3EA' },
  }
  const home = makeTeam(harbor, 'harbor')
  const away = makeTeam(vale, 'vale')
  return {
    setupVersion: MATCH_SETUP_VERSION,
    matchId: 'fixture_001',
    seed: 123456789,
    pitch: { ...DEFAULT_PITCH },
    clubs: [harbor, vale],
    teams: [home.team, away.team],
    players: [...home.players, ...away.players],
  }
}
