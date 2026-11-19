import { HIDDEN_CHARACTERISTICS } from '../../game/model/attributes'
import type { PlayerDefinition } from '../../game/model/player'

/**
 * First real-profile entry, based on the user's FMInside screenshots.
 * Every 1–20 rating below is transcribed from those images. 89/89 is the
 * user's supplied OVERALL/POTENTIAL, not a derived average or FM CA/PA.
 *
 * O11's engine uses 0–100. The mapping of display X to raw X*5 preserves
 * all screenshot values when converted back with ceil(raw/5), but it does
 * NOT claim five-point precision from an original 1–20 rating.
 */
export const BRUNO_ATTRIBUTE_SCREENSHOT = {
  technical: {
    crossing: 18,
    dribbling: 12,
    finishing: 15,
    firstTouch: 17,
    heading: 9,
    longShots: 15,
    marking: 3,
    passing: 18,
    tackling: 8,
    technique: 18,
  },
  mental: {
    aggression: 18,
    anticipation: 17,
    bravery: 15,
    composure: 15,
    concentration: 14,
    decisions: 13,
    determination: 18,
    flair: 17,
    leadership: 17,
    offTheBall: 16,
    defensivePositioning: 8,
    teamwork: 15,
    vision: 19,
    workRate: 18,
  },
  physical: {
    acceleration: 13,
    agility: 14,
    balance: 14,
    verticalLeap: 9,
    sprintSpeed: 13,
    stamina: 20,
    strength: 10,
  },
  hidden: { naturalFitness: 20 },
  setPieces: {
    corners: 17,
    freeKicks: 17,
    longThrows: 3,
    penaltyTaking: 19,
  },
} as const

export const BRUNO_FM_PLAYER_ID = '43124203'
export const MAN_UTD_FM_CLUB_ID = 680
export const BRUNO_OVR = 89
export const BRUNO_POTENTIAL = 89

const scaled = (score: number) => {
  if (!Number.isInteger(score) || score < 1 || score > 20) {
    throw new RangeError('Screenshot attributes must be integers between 1 and 20')
  }
  return score * 5
}

function scaleValues<K extends string>(ratings: Readonly<Record<K, number>>): Readonly<Record<K, number>> {
  return Object.fromEntries(Object.entries(ratings).map(([name, score]) => [name, scaled(score as number)])) as Record<K, number>
}

const displayed = BRUNO_ATTRIBUTE_SCREENSHOT
export const BRUNO_FERNANDES: PlayerDefinition = {
  id: BRUNO_FM_PLAYER_ID,
  clubId: 'club_man_utd',
  profile: {
    fullName: 'Bruno Fernandes',
    dateOfBirth: '1994-09-08',
    heightCm: 183,
    // Mass and weaker foot are not in the screenshots: provisional values.
    massKg: 70,
    preferredFoot: 'right',
    weakerFoot: 50,
  },
  abilities: {
    technical: {
      ...scaleValues(displayed.technical),
      ...scaleValues(displayed.setPieces),
    },
    mental: scaleValues(displayed.mental),
    physical: {
      ...scaleValues(displayed.physical),
      // The supplied images have no O11 Recovery rating.
      recovery: 70,
    },
    goalkeeping: null,
  },
  hidden: Object.fromEntries(HIDDEN_CHARACTERISTICS.map(name =>
    [name, name === 'naturalFitness' ? scaled(displayed.hidden.naturalFitness) : 65],
  )) as PlayerDefinition['hidden'],
  positionFamiliarity: {
    AM: 95,
    LCM: 88,
    RCM: 83,
    DM: 66,
  },
  tendencies: ['attemptsThroughBalls', 'shootsFromDistance'],
  referenceData: {
    system: 'Football Manager',
    externalPlayerId: 43124203,
    externalClubId: MAN_UTD_FM_CLUB_ID,
    overallRating: BRUNO_OVR,
    potentialRating: BRUNO_POTENTIAL,
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
