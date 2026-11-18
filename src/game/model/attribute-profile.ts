import type { PlayerDefinition } from './player'
import type { PlayerRole } from './team'
import type {
  TechnicalAttribute, MentalAttribute, PhysicalAttribute, GoalkeepingAttribute,
} from './attributes'

/**
 * Football attribute presentation built on the SAME authoritative 0–100
 * engine ratings. These categories do not alter physics, AI or saved data.
 * Natural fitness is intentionally read from the existing hidden traits,
 * never stored as a second conflicting physical attribute.
 */
export const ATTRIBUTE_CATEGORIES = {
  technical: [
    { path: 'technical.crossing', label: 'Crossing' },
    { path: 'technical.dribbling', label: 'Dribbling' },
    { path: 'technical.finishing', label: 'Finishing' },
    { path: 'technical.firstTouch', label: 'First Touch' },
    { path: 'technical.heading', label: 'Heading' },
    { path: 'technical.longShots', label: 'Long Shots' },
    { path: 'technical.marking', label: 'Marking' },
    { path: 'technical.passing', label: 'Passing' },
    { path: 'technical.tackling', label: 'Tackling' },
    { path: 'technical.technique', label: 'Technique' },
  ],
  mental: [
    { path: 'mental.aggression', label: 'Aggression' },
    { path: 'mental.anticipation', label: 'Anticipation' },
    { path: 'mental.bravery', label: 'Bravery' },
    { path: 'mental.composure', label: 'Composure' },
    { path: 'mental.concentration', label: 'Concentration' },
    { path: 'mental.decisions', label: 'Decisions' },
    { path: 'mental.determination', label: 'Determination' },
    { path: 'mental.flair', label: 'Flair' },
    { path: 'mental.leadership', label: 'Leadership' },
    { path: 'mental.offTheBall', label: 'Off the Ball' },
    { path: 'mental.defensivePositioning', label: 'Positioning' },
    { path: 'mental.teamwork', label: 'Teamwork' },
    { path: 'mental.vision', label: 'Vision' },
    { path: 'mental.workRate', label: 'Work Rate' },
  ],
  physical: [
    { path: 'physical.acceleration', label: 'Acceleration' },
    { path: 'physical.agility', label: 'Agility' },
    { path: 'physical.balance', label: 'Balance' },
    { path: 'physical.verticalLeap', label: 'Jumping Reach' },
    { path: 'hidden.naturalFitness', label: 'Natural Fitness' },
    { path: 'physical.sprintSpeed', label: 'Pace' },
    { path: 'physical.stamina', label: 'Stamina' },
    { path: 'physical.strength', label: 'Strength' },
  ],
  setPieces: [
    { path: 'technical.corners', label: 'Corners' },
    { path: 'technical.freeKicks', label: 'Free Kick Taking' },
    { path: 'technical.longThrows', label: 'Long Throws' },
    { path: 'technical.penaltyTaking', label: 'Penalty Taking' },
  ],
  goalkeeping: [
    { path: 'goalkeeping.positioning', label: 'Positioning' },
    { path: 'goalkeeping.reflexes', label: 'Reflexes' },
    { path: 'goalkeeping.diving', label: 'Diving' },
    { path: 'goalkeeping.handling', label: 'Handling' },
    { path: 'goalkeeping.parrying', label: 'Parrying' },
    { path: 'goalkeeping.oneOnOnes', label: 'One on Ones' },
    { path: 'goalkeeping.crossClaiming', label: 'Cross Claiming' },
    { path: 'goalkeeping.punching', label: 'Punching' },
    { path: 'goalkeeping.commandOfArea', label: 'Command of Area' },
    { path: 'goalkeeping.communication', label: 'Communication' },
    { path: 'goalkeeping.kickingDistribution', label: 'Kicking' },
    { path: 'goalkeeping.throwingDistribution', label: 'Throwing' },
    { path: 'goalkeeping.rushingOut', label: 'Rushing Out' },
  ],
} as const

export type AttributeCategory = keyof typeof ATTRIBUTE_CATEGORIES
export type AttributePath =
  (typeof ATTRIBUTE_CATEGORIES)[AttributeCategory][number]['path']

export const ATTRIBUTE_CATEGORY_LABELS: Record<AttributeCategory, string> = {
  technical: 'Technical', mental: 'Mental', physical: 'Physical',
  setPieces: 'Set Pieces', goalkeeping: 'Goalkeeping',
}

type RoleFocus = { readonly key: readonly AttributePath[]; readonly preferred: readonly AttributePath[] }
/** The highlights are recommended scouting priorities, not AI instructions. */
export const ATTRIBUTE_ROLE_FOCUS: Record<PlayerRole, RoleFocus> = {
  goalkeeper: {
    key: ['goalkeeping.reflexes','goalkeeping.handling','goalkeeping.positioning','goalkeeping.oneOnOnes'],
    preferred: ['goalkeeping.diving','goalkeeping.commandOfArea','goalkeeping.crossClaiming','mental.decisions'],
  },
  centreBack: {
    key: ['technical.marking','technical.tackling','mental.defensivePositioning','physical.verticalLeap'],
    preferred: ['technical.heading','mental.anticipation','physical.strength','mental.composure'],
  },
  fullBack: {
    key: ['technical.tackling','technical.crossing','physical.stamina','mental.workRate'],
    preferred: ['physical.acceleration','physical.sprintSpeed','technical.marking','mental.defensivePositioning'],
  },
  holdingMidfielder: {
    key: ['technical.passing','mental.decisions','mental.defensivePositioning','mental.teamwork'],
    preferred: ['technical.tackling','mental.anticipation','mental.vision','physical.stamina'],
  },
  centralMidfielder: {
    key: ['technical.passing','mental.decisions','mental.vision','physical.stamina'],
    preferred: ['technical.firstTouch','mental.offTheBall','mental.workRate','technical.technique'],
  },
  attackingMidfielder: {
    key: ['technical.firstTouch','technical.passing','mental.vision','mental.offTheBall'],
    preferred: ['technical.dribbling','mental.decisions','mental.flair','technical.longShots'],
  },
  winger: {
    key: ['technical.dribbling','physical.acceleration','physical.sprintSpeed','technical.crossing'],
    preferred: ['technical.firstTouch','mental.offTheBall','physical.agility','technical.finishing'],
  },
  advancedForward: {
    key: ['technical.finishing','mental.offTheBall','mental.composure','physical.acceleration'],
    preferred: ['technical.firstTouch','mental.anticipation','technical.heading','physical.sprintSpeed'],
  },
}

export function readAttribute(player: PlayerDefinition, path: AttributePath): number {
  const [group, key] = path.split('.')
  switch (group) {
    case 'technical': return player.abilities.technical[key as TechnicalAttribute]
    case 'mental': return player.abilities.mental[key as MentalAttribute]
    case 'physical': return player.abilities.physical[key as PhysicalAttribute]
    case 'hidden': return player.hidden.naturalFitness
    case 'goalkeeping':
      if (!player.abilities.goalkeeping) throw new Error('Outfield player has no goalkeeping ratings')
      return player.abilities.goalkeeping[key as GoalkeepingAttribute]
    default: throw new Error('Invalid player attribute path')
  }
}

/** 0–100 remains canonical; a displayed 1–20 value is a lossy conversion. */
export function toTwenty(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    throw new RangeError('Engine attribute must be between 0 and 100')
  }
  return Math.max(1, Math.ceil(raw / 5))
}

export interface AttributeRow {
  readonly path: AttributePath
  readonly label: string
  readonly raw: number
  readonly score: number
  readonly priority: 'key' | 'preferred' | null
}

export function categoryRows(
  player: PlayerDefinition, category: AttributeCategory, role: PlayerRole,
): readonly AttributeRow[] {
  const focus = ATTRIBUTE_ROLE_FOCUS[role]
  return ATTRIBUTE_CATEGORIES[category].map(({ path, label }) => {
    const raw = readAttribute(player, path)
    return {
      path, label, raw, score: toTwenty(raw),
      priority: focus.key.includes(path) ? 'key' as const :
        focus.preferred.includes(path) ? 'preferred' as const : null,
    }
  })
}

export interface ProfileAxis {
  readonly label: string
  readonly score: number
}
type ProfileDefinition = { readonly label: string; readonly paths: readonly AttributePath[] }
const OUTFIELD_PROFILE: readonly ProfileDefinition[] = [
  { label: 'Defending', paths: ['technical.tackling','technical.marking','mental.defensivePositioning'] },
  { label: 'Physical', paths: ['physical.stamina','physical.strength','physical.balance'] },
  { label: 'Speed', paths: ['physical.acceleration','physical.sprintSpeed','physical.agility'] },
  { label: 'Vision', paths: ['mental.vision','mental.decisions','mental.anticipation'] },
  { label: 'Attacking', paths: ['technical.finishing','technical.longShots','mental.offTheBall'] },
  { label: 'Technical', paths: ['technical.passing','technical.firstTouch','technical.dribbling','technical.technique'] },
  { label: 'Aerial', paths: ['technical.heading','physical.verticalLeap','physical.strength'] },
  { label: 'Mental', paths: ['mental.composure','mental.concentration','mental.teamwork','mental.determination'] },
]
const KEEPER_PROFILE: readonly ProfileDefinition[] = [
  { label: 'Reflexes', paths: ['goalkeeping.reflexes','goalkeeping.diving'] },
  { label: 'Handling', paths: ['goalkeeping.handling','goalkeeping.parrying'] },
  { label: 'Area', paths: ['goalkeeping.commandOfArea','goalkeeping.crossClaiming'] },
  { label: 'Position', paths: ['goalkeeping.positioning','goalkeeping.oneOnOnes'] },
  { label: 'Rushing', paths: ['goalkeeping.rushingOut','physical.acceleration'] },
  { label: 'Passing', paths: ['goalkeeping.kickingDistribution','technical.passing'] },
  { label: 'Throwing', paths: ['goalkeeping.throwingDistribution','mental.decisions'] },
  { label: 'Mental', paths: ['goalkeeping.communication','mental.concentration'] },
]
/** Derived averages only; no synthetic independent attributes enter matches. */
export function attributeProfile(player: PlayerDefinition): readonly ProfileAxis[] {
  const axes = player.abilities.goalkeeping ? KEEPER_PROFILE : OUTFIELD_PROFILE
  return axes.map(({ label, paths }) => {
    const mean = paths.reduce((sum, path) => sum + readAttribute(player, path), 0) / paths.length
    return { label, score: Math.round(Math.max(1, mean / 5) * 10) / 10 }
  })
}
