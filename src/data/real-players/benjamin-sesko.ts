import { HIDDEN_CHARACTERISTICS } from '../../game/model/attributes'
import type { PlayerDefinition } from '../../game/model/player'
import { MAN_UTD_FM_CLUB_ID } from './bruno-fernandes'

/**
 * Benjamin Šeško: all 36 visible 1–20 attributes from the user's screenshots.
 * Overall 75 / potential 85 are supplied ratings, not calculated engine CA/PA.
 * Incomplete auxiliary engine values are explicitly flagged as provisional.
 */
export const SESKO_ATTRIBUTE_SCREENSHOT = {
  technical: {
    crossing: 7, dribbling: 13, finishing: 14, firstTouch: 14,
    heading: 14, longShots: 12, marking: 5, passing: 12,
    tackling: 8, technique: 14,
  },
  mental: {
    aggression: 13, anticipation: 14, bravery: 14, composure: 13,
    concentration: 12, decisions: 13, determination: 15, flair: 14,
    leadership: 8, offTheBall: 15, defensivePositioning: 5,
    teamwork: 14, vision: 11, workRate: 15,
  },
  physical: {
    acceleration: 15, agility: 14, balance: 14, verticalLeap: 17,
    sprintSpeed: 17, stamina: 15, strength: 15,
  },
  hidden: { naturalFitness: 16 },
  setPieces: {
    corners: 3, freeKicks: 10, longThrows: 8, penaltyTaking: 17,
  },
} as const

export const SESKO_FM_PLAYER_ID = '62246208'
export const SESKO_OVR = 75
export const SESKO_POTENTIAL = 85

function scale<K extends string>(ratings: Readonly<Record<K, number>>): Readonly<Record<K, number>> {
  return Object.fromEntries(Object.entries(ratings).map(([key, value]) => {
    const score = Number(value)
    if (!Number.isInteger(score) || score < 1 || score > 20) {
      throw new Error('Invalid screenshot attribute: ' + key)
    }
    return [key, score * 5]
  })) as Record<K, number>
}

export const BENJAMIN_SESKO: PlayerDefinition = {
  id: SESKO_FM_PLAYER_ID,
  clubId: 'club_man_utd',
  profile: {
    fullName: 'Benjamin Šeško',
    dateOfBirth: '2003-05-31',
    heightCm: 195,
    massKg: 85,
    preferredFoot: 'right',
    weakerFoot: 50,
  },
  abilities: {
    technical: { ...scale(SESKO_ATTRIBUTE_SCREENSHOT.technical), ...scale(SESKO_ATTRIBUTE_SCREENSHOT.setPieces) },
    mental: scale(SESKO_ATTRIBUTE_SCREENSHOT.mental),
    physical: {
      ...scale(SESKO_ATTRIBUTE_SCREENSHOT.physical),
      recovery: 70,
    },
    goalkeeping: null,
  },
  hidden: Object.fromEntries(HIDDEN_CHARACTERISTICS.map(key => [
    key, key === 'naturalFitness' ? SESKO_ATTRIBUTE_SCREENSHOT.hidden.naturalFitness * 5 : 65,
  ])) as PlayerDefinition['hidden'],
  positionFamiliarity: { ST: 95 },
  tendencies: ['runsBeyondDefence'],
  referenceData: {
    system: 'Football Manager',
    externalPlayerId: 62246208,
    externalClubId: MAN_UTD_FM_CLUB_ID,
    overallRating: SESKO_OVR,
    potentialRating: SESKO_POTENTIAL,
    attributeSource: 'user-supplied screenshots',
    provisionalFields: [
      'profile.massKg',
      'profile.weakerFoot',
      'abilities.physical.recovery',
      'hidden (except naturalFitness)',
      'positionFamiliarity',
      'tendencies',
    ],
  },
}
