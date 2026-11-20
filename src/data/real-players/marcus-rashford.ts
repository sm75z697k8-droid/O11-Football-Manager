import { HIDDEN_CHARACTERISTICS } from '../../game/model/attributes'
import type { PlayerDefinition } from '../../game/model/player'
import { MAN_UTD_FM_CLUB_ID } from './bruno-fernandes'

/**
 * Marcus Rashford: 36 1–20 attributes transcribed from screenshots supplied
 * by the user. Overall 77 and potential 87 are user-supplied profile
 * summaries, not O11's computed ability or potential.
 *
 * Screenshot values are mapped to O11's 0–100 rating system as value * 5.
 * Engine fields not shown in the screenshots remain explicitly provisional.
 */
export const RASHFORD_ATTRIBUTE_SCREENSHOT = {
  technical: {
    crossing: 13, dribbling: 15, finishing: 14, firstTouch: 14,
    heading: 12, longShots: 13, marking: 4, passing: 14,
    tackling: 4, technique: 15,
  },
  mental: {
    aggression: 10, anticipation: 13, bravery: 10, composure: 11,
    concentration: 12, decisions: 11, determination: 13, flair: 16,
    leadership: 10, offTheBall: 16, defensivePositioning: 4,
    teamwork: 11, vision: 13, workRate: 10,
  },
  physical: {
    acceleration: 15, agility: 15, balance: 15, verticalLeap: 12,
    sprintSpeed: 17, stamina: 14, strength: 15,
  },
  hidden: { naturalFitness: 14 },
  setPieces: {
    corners: 13, freeKicks: 14, longThrows: 5, penaltyTaking: 16,
  },
} as const

export const RASHFORD_FM_PLAYER_ID = '28100266'
export const RASHFORD_OVR = 77
export const RASHFORD_POTENTIAL = 87

function scale<K extends string>(ratings: Readonly<Record<K, number>>): Readonly<Record<K, number>> {
  return Object.fromEntries(Object.entries(ratings).map(([key, value]) => {
    const rating = Number(value)
    if (!Number.isInteger(rating) || rating < 1 || rating > 20) {
      throw new RangeError('Invalid screenshot attribute: ' + key)
    }
    return [key, rating * 5]
  })) as Record<K, number>
}

export const MARCUS_RASHFORD: PlayerDefinition = {
  id: RASHFORD_FM_PLAYER_ID,
  clubId: 'club_man_utd',
  profile: {
    fullName: 'Marcus Rashford',
    dateOfBirth: '1997-10-31',
    // Height is recorded inconsistently across official sources; provisional.
    heightCm: 180,
    massKg: 75,
    preferredFoot: 'right',
    weakerFoot: 50,
  },
  abilities: {
    technical: {
      ...scale(RASHFORD_ATTRIBUTE_SCREENSHOT.technical),
      ...scale(RASHFORD_ATTRIBUTE_SCREENSHOT.setPieces),
    },
    mental: scale(RASHFORD_ATTRIBUTE_SCREENSHOT.mental),
    physical: {
      ...scale(RASHFORD_ATTRIBUTE_SCREENSHOT.physical),
      recovery: 70,
    },
    goalkeeping: null,
  },
  hidden: Object.fromEntries(HIDDEN_CHARACTERISTICS.map(key => [
    key, key === 'naturalFitness'
      ? RASHFORD_ATTRIBUTE_SCREENSHOT.hidden.naturalFitness * 5 : 65,
  ])) as PlayerDefinition['hidden'],
  positionFamiliarity: { LW: 95, ST: 82, RW: 74 },
  tendencies: ['cutsInside', 'runsBeyondDefence'],
  referenceData: {
    system: 'Football Manager',
    externalPlayerId: 28100266,
    externalClubId: MAN_UTD_FM_CLUB_ID,
    overallRating: RASHFORD_OVR,
    potentialRating: RASHFORD_POTENTIAL,
    attributeSource: 'user-supplied screenshots',
    provisionalFields: [
      'profile.heightCm', 'profile.massKg', 'profile.weakerFoot',
      'abilities.physical.recovery',
      'hidden (except naturalFitness)',
      'positionFamiliarity', 'tendencies',
    ],
  },
}
