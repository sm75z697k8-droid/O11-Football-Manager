import type { PlayerAbilities, PlayerHiddenCharacteristics } from './attributes'

export type PlayerId = string
export type ClubId = string

export const POSITIONS = [
  'GK', 'RB', 'RCB', 'LCB', 'LB', 'DM', 'RCM', 'LCM',
  'RW', 'ST', 'LW', 'AM',
] as const
export type PositionCode = (typeof POSITIONS)[number]
export type PreferredFoot = 'left' | 'right'

/** Tendencies affect preferred choices, never automatically execution quality. */
export const PLAYER_TENDENCIES = [
  'cutsInside', 'attemptsThroughBalls', 'runsBeyondDefence',
  'shootsFromDistance', 'holdsPosition', 'pressesAggressively',
  'distributesShort', 'rushesOutOften',
] as const
export type PlayerTendency = (typeof PLAYER_TENDENCIES)[number]

export interface PlayerProfile {
  readonly fullName: string
  /** Calendar date YYYY-MM-DD; not local-device time. */
  readonly dateOfBirth: string
  readonly heightCm: number
  readonly massKg: number
  readonly preferredFoot: PreferredFoot
  /** Weaker-foot proficiency, 0–100. */
  readonly weakerFoot: number
}

/** Initial football data; mutable match state is intentionally NOT modeled here. */
export interface PlayerDefinition {
  readonly id: PlayerId
  readonly clubId: ClubId
  readonly profile: PlayerProfile
  readonly abilities: PlayerAbilities
  readonly hidden: PlayerHiddenCharacteristics
  readonly positionFamiliarity: Readonly<Partial<Record<PositionCode, number>>>
  readonly tendencies: readonly PlayerTendency[]
}
