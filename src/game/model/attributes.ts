/**
 * O11 canonical attribute taxonomy v1.0.
 * Values are integer ratings in [0, 100], NOT success probabilities.
 * Derived profile categories are presentation-only, not engine attributes.
 */
export const TECHNICAL_ATTRIBUTES = [
  'passing', 'firstTouch', 'dribbling', 'technique', 'finishing',
  'longShots', 'heading', 'tackling', 'marking', 'crossing',
  'corners', 'freeKicks', 'penaltyTaking', 'longThrows',
] as const

export const MENTAL_ATTRIBUTES = [
  'vision', 'decisions', 'anticipation', 'composure', 'concentration',
  'offTheBall', 'defensivePositioning', 'teamwork', 'workRate',
  'bravery', 'aggression', 'flair', 'leadership', 'determination',
] as const

export const PHYSICAL_ATTRIBUTES = [
  'acceleration', 'sprintSpeed', 'agility', 'balance',
  'stamina', 'strength', 'verticalLeap', 'recovery',
] as const

export const GOALKEEPING_ATTRIBUTES = [
  'positioning', 'reflexes', 'diving', 'handling', 'parrying',
  'oneOnOnes', 'crossClaiming', 'punching', 'commandOfArea',
  'communication', 'kickingDistribution', 'throwingDistribution', 'rushingOut',
] as const

export const HIDDEN_CHARACTERISTICS = [
  'professionalism', 'ambition', 'loyalty', 'adaptability',
  'temperament', 'sportsmanship', 'consistency', 'bigMatchResponse',
  'naturalFitness', 'injurySusceptibility', 'versatility',
] as const

export const PROFILE_GROUPS = [
  'playmaking', 'shooting', 'ballControl', 'defending', 'aerial',
  'physical', 'mental', 'setPieces', 'goalkeeping', 'personality',
] as const

export type TechnicalAttribute = (typeof TECHNICAL_ATTRIBUTES)[number]
export type MentalAttribute = (typeof MENTAL_ATTRIBUTES)[number]
export type PhysicalAttribute = (typeof PHYSICAL_ATTRIBUTES)[number]
export type GoalkeepingAttribute = (typeof GOALKEEPING_ATTRIBUTES)[number]
export type HiddenCharacteristic = (typeof HIDDEN_CHARACTERISTICS)[number]
export type ProfileGroup = (typeof PROFILE_GROUPS)[number]

export type RatingSet<K extends string> = Readonly<Record<K, number>>

export interface PlayerAbilities {
  readonly technical: RatingSet<TechnicalAttribute>
  readonly mental: RatingSet<MentalAttribute>
  readonly physical: RatingSet<PhysicalAttribute>
  /** Null means not applicable; a starting goalkeeper must supply all 13. */
  readonly goalkeeping: RatingSet<GoalkeepingAttribute> | null
}

export type PlayerHiddenCharacteristics = RatingSet<HiddenCharacteristic>

export const CORE_ATTRIBUTE_COUNT =
  TECHNICAL_ATTRIBUTES.length +
  MENTAL_ATTRIBUTES.length +
  PHYSICAL_ATTRIBUTES.length +
  GOALKEEPING_ATTRIBUTES.length
