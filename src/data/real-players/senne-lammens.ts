import { HIDDEN_CHARACTERISTICS, GOALKEEPING_ATTRIBUTES, TECHNICAL_ATTRIBUTES } from '../../game/model/attributes'
import type { PlayerDefinition } from '../../game/model/player'
import { MAN_UTD_FM_CLUB_ID } from './bruno-fernandes'

/**
 * Senne Lammens — screenshot source values, not extrapolated FM internals.
 * The screenshots give no numeric value for Aggression, Flair, Free Kick
 * Taking, or Penalty Taking (icon only). We keep those as null in this source.
 * Aerial Reach, Eccentricity and two labelled TENDENCIES are not identical
 * to the O11 keeper engine skills; they are stored separately as references.
 */
export const LAMMENS_SCREENSHOT = {
  goalkeeping: {
    aerialReach: 15,
    commandOfArea: 15,
    communication: 14,
    eccentricity: 4,
    handling: 16,
    kickingDistribution: 14,
    oneOnOnes: 14,
    punchingTendency: 10,
    reflexes: 15,
    rushingOutTendency: 10,
    throwingDistribution: 12,
  },
  technical: {
    firstTouch: 14,
    passing: 13,
    technique: 12,
  },
  mental: {
    aggression: null,
    anticipation: 13,
    bravery: 13,
    composure: 15,
    concentration: 15,
    decisions: 14,
    determination: 18,
    flair: null,
    leadership: 12,
    offTheBall: 12,
    defensivePositioning: 14,
    teamwork: 12,
    vision: 11,
    workRate: 12,
  },
  physical: {
    acceleration: 13,
    agility: 14,
    balance: 10,
    verticalLeap: 15,
    sprintSpeed: 11,
    stamina: 12,
    strength: 13,
  },
  hidden: { naturalFitness: 12 },
  setPieces: { freeKicks: null, penaltyTaking: null },
} as const

export const LAMMENS_FM_PLAYER_ID = '18107436'
export const LAMMENS_OVR = 77
export const LAMMENS_POTENTIAL = 83

function toRaw(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new RangeError('Screenshot rating must be between 1 and 20')
  }
  return value * 5
}
const source = LAMMENS_SCREENSHOT

/**
 * The authoritative O11 simulation values remain integer 0–100. A supplied
 * value of 14/20 is mapped to 70/100. Anything not on the screenshots is an
 * explicit provisional estimate rather than a purported external rating.
 */
export const SENNE_LAMMENS: PlayerDefinition = {
  id: LAMMENS_FM_PLAYER_ID,
  clubId: 'club_man_utd',
  profile: {
    fullName: 'Senne Lammens',
    dateOfBirth: '2002-07-07',
    heightCm: 193,
    // 85 kg and weaker-foot proficiency are not in the screenshots.
    massKg: 85,
    preferredFoot: 'right',
    weakerFoot: 50,
  },
  abilities: {
    technical: Object.fromEntries(TECHNICAL_ATTRIBUTES.map(key => {
      const supplied = source.technical[key as keyof typeof source.technical]
      return [key, supplied === undefined ? 50 : toRaw(supplied)]
    })) as PlayerDefinition['abilities']['technical'],
    mental: {
      ...Object.fromEntries(Object.entries(source.mental).map(([key, rating]) =>
        [key, rating === null ? 50 : toRaw(rating)],
      )),
    } as PlayerDefinition['abilities']['mental'],
    physical: {
      acceleration: toRaw(source.physical.acceleration),
      sprintSpeed: toRaw(source.physical.sprintSpeed),
      agility: toRaw(source.physical.agility),
      balance: toRaw(source.physical.balance),
      stamina: toRaw(source.physical.stamina),
      strength: toRaw(source.physical.strength),
      verticalLeap: toRaw(source.physical.verticalLeap),
      recovery: 65,
    },
    goalkeeping: Object.fromEntries(GOALKEEPING_ATTRIBUTES.map(key => {
      const values = source.goalkeeping
      const supplied = values[key as keyof typeof values]
      // NOTE: "Punching (Tendency)" and "Rushing Out (Tendency)" do
      // NOT map to O11 execution skills. Their 10/20 ratings stay in
      // referenceData.screenshotOnlyRatings, not used for physics/AI.
      const directlyMapped = [
        'commandOfArea', 'communication', 'handling', 'kickingDistribution',
        'oneOnOnes', 'reflexes', 'throwingDistribution',
      ].includes(key)
      if (directlyMapped && typeof supplied === 'number') return [key, toRaw(supplied)]
      const estimates: Record<string, number> = {
        positioning: 70,
        diving: 72,
        parrying: 72,
        crossClaiming: 70,
        punching: 60,
        rushingOut: 60,
      }
      return [key, estimates[key] ?? 65]
    })) as NonNullable<PlayerDefinition['abilities']['goalkeeping']>,
  },
  hidden: Object.fromEntries(HIDDEN_CHARACTERISTICS.map(key =>
    [key, key === 'naturalFitness' ? toRaw(source.hidden.naturalFitness) : 65],
  )) as PlayerDefinition['hidden'],
  positionFamiliarity: { GK: 95 },
  tendencies: [],
  referenceData: {
    system: 'Football Manager',
    externalPlayerId: 18107436,
    externalClubId: MAN_UTD_FM_CLUB_ID,
    overallRating: LAMMENS_OVR,
    potentialRating: LAMMENS_POTENTIAL,
    attributeSource: 'user-supplied screenshots',
    unratedAttributes: [
      'mental.aggression', 'mental.flair',
      'technical.freeKicks', 'technical.penaltyTaking',
    ],
    screenshotOnlyRatings: [
      { category: 'goalkeeping', label: 'Aerial Reach', score: 15 },
      { category: 'goalkeeping', label: 'Eccentricity', score: 4 },
      { category: 'goalkeeping', label: 'Punching (Tendency)', score: 10 },
      { category: 'goalkeeping', label: 'Rushing Out (Tendency)', score: 10 },
    ],
    provisionalFields: [
      'profile.massKg', 'profile.weakerFoot',
      'abilities.technical (except firstTouch, passing, technique)',
      'abilities.technical.freeKicks', 'abilities.technical.penaltyTaking',
      'abilities.mental.aggression', 'abilities.mental.flair',
      'abilities.physical.recovery',
      'abilities.goalkeeping.positioning', 'abilities.goalkeeping.diving',
      'abilities.goalkeeping.parrying', 'abilities.goalkeeping.crossClaiming',
      'abilities.goalkeeping.punching', 'abilities.goalkeeping.rushingOut',
      'hidden (except naturalFitness)',
      'positionFamiliarity', 'tendencies',
    ],
  },
}
