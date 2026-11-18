import {
  GOALKEEPING_ATTRIBUTES, HIDDEN_CHARACTERISTICS, MENTAL_ATTRIBUTES,
  PHYSICAL_ATTRIBUTES, TECHNICAL_ATTRIBUTES,
} from '../game/model/attributes'
import type {
  GoalkeepingAttribute, MentalAttribute, PhysicalAttribute, TechnicalAttribute,
} from '../game/model/attributes'
import type { PlayerDefinition, PlayerTendency, PreferredFoot } from '../game/model/player'
import type { Point2 } from '../game/model/pitch'
import { AVAILABLE_ROLES_BY_SLOT, FORMATION_433_SLOTS } from '../game/model/team'
import type { ClubDefinition, Formation433Slot, PlayerDuty, TeamSheet } from '../game/model/team'

/**
 * Fictional senior XI: player identities and ratings are authored test-game
 * content, NOT real-world scouting data. This roster is independent of the
 * preserved Harbor v Vale diagnostic fixture and does not start a match.
 */
export const FIRST_TEAM_CLUB: ClubDefinition = {
  id: 'club_harbor',
  name: 'Harbor Athletic',
  shortName: 'HAR',
  colors: { primary: '#3A9CE8', secondary: '#E8F5FF' },
}

interface SeniorPlayerSeed {
  readonly slot: Formation433Slot
  readonly number: number
  readonly name: string
  readonly born: string
  readonly height: number
  readonly weight: number
  readonly foot: PreferredFoot
  readonly weakerFoot: number
  readonly baseTechnical: number
  readonly baseMental: number
  readonly basePhysical: number
  readonly technique?: Partial<Record<TechnicalAttribute, number>>
  readonly mentality?: Partial<Record<MentalAttribute, number>>
  readonly physique?: Partial<Record<PhysicalAttribute, number>>
  readonly keeping?: Partial<Record<GoalkeepingAttribute, number>>
  readonly tendencies: readonly PlayerTendency[]
}

const SENIOR_XI: readonly SeniorPlayerSeed[] = [
  { slot: 'GK', number: 1, name: 'Samir Rahman', born: '1997-05-18', height: 190, weight: 84, foot: 'right', weakerFoot: 38,
    baseTechnical: 49, baseMental: 65, basePhysical: 55,
    technique: { passing: 60, firstTouch: 55 },
    mentality: { concentration: 76, composure: 69, decisions: 68 },
    keeping: { positioning: 77, reflexes: 78, diving: 76, handling: 74, commandOfArea: 72, crossClaiming: 72 },
    tendencies: ['distributesShort'] },
  { slot: 'RB', number: 2, name: 'Ethan Brooks', born: '2001-03-21', height: 180, weight: 74, foot: 'right', weakerFoot: 34,
    baseTechnical: 62, baseMental: 61, basePhysical: 69,
    technique: { tackling: 73, marking: 68, crossing: 70 },
    physique: { acceleration: 75, sprintSpeed: 74, stamina: 77 },
    tendencies: [] },
  { slot: 'RCB', number: 4, name: 'Leo Bennett', born: '1999-08-12', height: 187, weight: 82, foot: 'right', weakerFoot: 41,
    baseTechnical: 57, baseMental: 67, basePhysical: 65,
    technique: { tackling: 78, marking: 77, heading: 76 },
    mentality: { defensivePositioning: 78, bravery: 74 },
    physique: { strength: 77, verticalLeap: 72 },
    tendencies: ['holdsPosition'] },
  { slot: 'LCB', number: 5, name: 'Adil Khan', born: '2000-10-04', height: 184, weight: 80, foot: 'left', weakerFoot: 39,
    baseTechnical: 61, baseMental: 67, basePhysical: 64,
    technique: { passing: 73, tackling: 75, marking: 74, heading: 71 },
    mentality: { defensivePositioning: 76, anticipation: 73 },
    tendencies: ['holdsPosition'] },
  { slot: 'LB', number: 3, name: 'Mateo Silva', born: '2002-01-26', height: 176, weight: 71, foot: 'left', weakerFoot: 43,
    baseTechnical: 67, baseMental: 62, basePhysical: 72,
    technique: { crossing: 74, firstTouch: 69, tackling: 67 },
    physique: { acceleration: 78, stamina: 76 },
    tendencies: [] },
  { slot: 'DM', number: 6, name: 'Noah Fletcher', born: '1998-11-17', height: 183, weight: 78, foot: 'right', weakerFoot: 50,
    baseTechnical: 67, baseMental: 73, basePhysical: 67,
    technique: { passing: 76, tackling: 74 },
    mentality: { vision: 74, decisions: 78, defensivePositioning: 77, teamwork: 78 },
    tendencies: ['holdsPosition'] },
  { slot: 'RCM', number: 8, name: 'Daniel Mercer', born: '2001-07-09', height: 178, weight: 73, foot: 'right', weakerFoot: 46,
    baseTechnical: 73, baseMental: 70, basePhysical: 66,
    technique: { passing: 79, firstTouch: 75 },
    mentality: { vision: 78, decisions: 73, workRate: 75 },
    tendencies: ['attemptsThroughBalls'] },
  { slot: 'LCM', number: 10, name: 'Rafiq Idris', born: '2000-04-30', height: 175, weight: 70, foot: 'left', weakerFoot: 48,
    baseTechnical: 73, baseMental: 70, basePhysical: 67,
    technique: { dribbling: 76, passing: 77, longShots: 71 },
    mentality: { flair: 76, offTheBall: 73, vision: 75 },
    tendencies: ['attemptsThroughBalls'] },
  { slot: 'RW', number: 7, name: 'Elias Navarro', born: '2003-02-15', height: 173, weight: 69, foot: 'right', weakerFoot: 45,
    baseTechnical: 75, baseMental: 65, basePhysical: 73,
    technique: { dribbling: 82, crossing: 77, firstTouch: 76 },
    physique: { acceleration: 84, sprintSpeed: 82 },
    tendencies: ['cutsInside'] },
  { slot: 'ST', number: 9, name: 'Karim Haddad', born: '1999-12-08', height: 186, weight: 82, foot: 'right', weakerFoot: 42,
    baseTechnical: 71, baseMental: 70, basePhysical: 74,
    technique: { finishing: 82, heading: 78, firstTouch: 73 },
    mentality: { anticipation: 77, offTheBall: 80, composure: 75 },
    tendencies: ['runsBeyondDefence'] },
  { slot: 'LW', number: 11, name: 'Lucas Duarte', born: '2002-09-23', height: 177, weight: 72, foot: 'right', weakerFoot: 51,
    baseTechnical: 75, baseMental: 67, basePhysical: 74,
    technique: { dribbling: 79, finishing: 74, firstTouch: 77 },
    physique: { acceleration: 82, agility: 80 },
    tendencies: ['cutsInside'] },
]

function attributeSet<K extends string>(
  keys: readonly K[], baseline: number, differences: Partial<Record<K, number>> = {},
): Readonly<Record<K, number>> {
  return Object.fromEntries(keys.map(key => [key, differences[key] ?? baseline])) as Record<K, number>
}

export const FIRST_TEAM_PLAYERS: readonly PlayerDefinition[] = SENIOR_XI.map((seed, index) => ({
  id: 'harbor_senior_' + String(seed.number).padStart(2, '0'),
  clubId: FIRST_TEAM_CLUB.id,
  profile: {
    fullName: seed.name, dateOfBirth: seed.born, heightCm: seed.height,
    massKg: seed.weight, preferredFoot: seed.foot, weakerFoot: seed.weakerFoot,
  },
  abilities: {
    technical: attributeSet(TECHNICAL_ATTRIBUTES, seed.baseTechnical, seed.technique),
    mental: attributeSet(MENTAL_ATTRIBUTES, seed.baseMental, seed.mentality),
    physical: attributeSet(PHYSICAL_ATTRIBUTES, seed.basePhysical, seed.physique),
    goalkeeping: seed.slot === 'GK'
      ? attributeSet(GOALKEEPING_ATTRIBUTES, 67, seed.keeping) : null,
  },
  hidden: attributeSet(HIDDEN_CHARACTERISTICS, 55 + (index * 7) % 19),
  positionFamiliarity: { [seed.slot]: 85 + (index % 4) * 3 },
  tendencies: seed.tendencies,
}))

const dutyFor = (slot: Formation433Slot): PlayerDuty =>
  slot === 'RW' || slot === 'LW' || slot === 'ST' ? 'attack'
    : slot === 'RCM' || slot === 'LCM' ? 'support' : 'defend'

export const FIRST_TEAM_SHEET: TeamSheet = {
  clubId: FIRST_TEAM_CLUB.id,
  formation: '4-3-3',
  starters: SENIOR_XI.map((seed, index) => ({
    playerId: FIRST_TEAM_PLAYERS[index].id,
    slot: seed.slot,
    role: AVAILABLE_ROLES_BY_SLOT[seed.slot][0],
    duty: dutyFor(seed.slot),
    shirtNumber: seed.number,
  })),
}

/** Static tactical diagram, NOT positions produced by the live simulation. */
export const FIRST_TEAM_POSITIONS: Readonly<Record<Formation433Slot, Point2>> = {
  GK: { xM: 8, yM: 34 },
  RB: { xM: 31, yM: 56 },
  RCB: { xM: 25, yM: 42 },
  LCB: { xM: 25, yM: 26 },
  LB: { xM: 31, yM: 12 },
  DM: { xM: 45, yM: 34 },
  RCM: { xM: 58, yM: 46 },
  LCM: { xM: 58, yM: 22 },
  RW: { xM: 78, yM: 57 },
  ST: { xM: 82, yM: 34 },
  LW: { xM: 78, yM: 11 },
}

export const FIRST_TEAM = {
  club: FIRST_TEAM_CLUB,
  sheet: FIRST_TEAM_SHEET,
  players: FIRST_TEAM_PLAYERS,
  positions: FIRST_TEAM_POSITIONS,
} as const

// Protect the full 4-3-3 contract in case the senior roster is edited.
if (FIRST_TEAM_SHEET.starters.some((starter, i) => starter.slot !== FORMATION_433_SLOTS[i])) {
  throw new Error('First-team roster must follow the canonical 4-3-3 formation slots')
}
