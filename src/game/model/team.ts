import type { ClubId, PlayerId, PositionCode } from './player'

export interface ClubDefinition {
  readonly id: ClubId
  readonly name: string
  readonly shortName: string
  readonly colors: {
    readonly primary: string
    readonly secondary: string
  }
}

export const FORMATION_433_SLOTS = [
  'GK', 'RB', 'RCB', 'LCB', 'LB', 'DM', 'RCM', 'LCM', 'RW', 'ST', 'LW',
] as const satisfies readonly PositionCode[]

export type Formation433Slot = (typeof FORMATION_433_SLOTS)[number]

export const PLAYER_ROLES = [
  'goalkeeper', 'centreBack', 'fullBack', 'holdingMidfielder',
  'centralMidfielder', 'attackingMidfielder', 'winger', 'advancedForward',
] as const
export type PlayerRole = (typeof PLAYER_ROLES)[number]
export type PlayerDuty = 'defend' | 'support' | 'attack'

/** Role family compatibility for the initial 4-3-3, not a complete tactical engine. */
export const AVAILABLE_ROLES_BY_SLOT: Readonly<Record<Formation433Slot, readonly PlayerRole[]>> = {
  GK: ['goalkeeper'],
  RB: ['fullBack'],
  RCB: ['centreBack'],
  LCB: ['centreBack'],
  LB: ['fullBack'],
  DM: ['holdingMidfielder'],
  RCM: ['centralMidfielder'],
  LCM: ['centralMidfielder'],
  RW: ['winger'],
  ST: ['advancedForward'],
  LW: ['winger'],
}

export interface StartingAssignment {
  readonly playerId: PlayerId
  readonly slot: Formation433Slot
  readonly role: PlayerRole
  readonly duty: PlayerDuty
  readonly shirtNumber: number
}

export interface TeamSheet {
  readonly clubId: ClubId
  /** Only 4-3-3 is supported by the first fixture contract. */
  readonly formation: '4-3-3'
  readonly starters: readonly StartingAssignment[]
}
