import {
  GOALKEEPING_ATTRIBUTES, HIDDEN_CHARACTERISTICS, MENTAL_ATTRIBUTES,
  PHYSICAL_ATTRIBUTES, TECHNICAL_ATTRIBUTES,
} from '../game/model/attributes'
import { MATCH_SETUP_VERSION } from '../game/model/match'
import type { MatchSetup } from '../game/model/match'
import { PLAYER_TENDENCIES, POSITIONS } from '../game/model/player'
import { AVAILABLE_ROLES_BY_SLOT, FORMATION_433_SLOTS, PLAYER_ROLES } from '../game/model/team'
import type { Formation433Slot, PlayerRole } from '../game/model/team'
import type { PitchDefinition } from '../game/model/pitch'

export interface ValidationIssue {
  readonly path: string
  readonly message: string
}
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }

type RecordValue = Record<string, unknown>
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const rating = (value: unknown): boolean =>
  finite(value) && Number.isInteger(value) && value >= 0 && value <= 100
const inSet = (value: unknown, choices: readonly string[]): value is string =>
  typeof value === 'string' && choices.includes(value)
const isoDate = (value: unknown): boolean => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function validateRatingSet(
  value: unknown, keys: readonly string[], path: string, errors: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Expected a record of attribute ratings' })
    return
  }
  for (const key of keys) {
    if (!rating(value[key])) errors.push({ path: path + '.' + key, message: 'Expected an integer from 0 to 100' })
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push({ path: path + '.' + key, message: 'Unknown attribute' })
  }
}

function validatePitch(pitch: unknown, errors: ValidationIssue[]): void {
  if (!isRecord(pitch)) {
    errors.push({ path: 'pitch', message: 'Expected a pitch definition' })
    return
  }
  const keys: readonly (keyof PitchDefinition)[] = [
    'lengthM', 'widthM', 'goalWidthM', 'goalHeightM',
    'penaltyAreaDepthM', 'penaltyAreaWidthM', 'goalAreaDepthM',
    'goalAreaWidthM', 'penaltySpotDistanceM', 'centreCircleRadiusM',
  ]
  for (const key of keys) {
    if (!finite(pitch[key]) || pitch[key] <= 0) {
      errors.push({ path: 'pitch.' + key, message: 'Expected a positive finite metric measurement' })
    }
  }
  for (const key of Object.keys(pitch)) {
    if (!keys.includes(key as keyof PitchDefinition)) errors.push({ path: 'pitch.' + key, message: 'Unknown pitch dimension' })
  }
  if (!keys.every((key) => finite(pitch[key]) && pitch[key] > 0)) return
  const p = pitch as unknown as PitchDefinition
  if (p.lengthM < 90 || p.lengthM > 120 || p.widthM < 45 || p.widthM > 90) {
    errors.push({ path: 'pitch', message: 'Pitch must fall within supported length/width limits' })
  }
  if (p.goalWidthM >= p.goalAreaWidthM || p.goalHeightM > 3 ||
      p.goalAreaWidthM >= p.penaltyAreaWidthM || p.penaltyAreaWidthM > p.widthM ||
      p.goalAreaDepthM >= p.penaltyAreaDepthM || p.penaltyAreaDepthM >= p.lengthM / 2 ||
      p.penaltySpotDistanceM >= p.penaltyAreaDepthM ||
      p.centreCircleRadiusM >= Math.min(p.lengthM, p.widthM) / 2) {
    errors.push({ path: 'pitch', message: 'Pitch marking geometry is inconsistent' })
  }
}

function validatePlayer(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Expected player data' })
    return
  }
  if (!nonEmpty(value.id)) errors.push({ path: path + '.id', message: 'Missing player ID' })
  if (!nonEmpty(value.clubId)) errors.push({ path: path + '.clubId', message: 'Missing club ID' })
  const profile = value.profile
  if (!isRecord(profile)) {
    errors.push({ path: path + '.profile', message: 'Missing player profile' })
  } else {
    if (!nonEmpty(profile.fullName)) errors.push({ path: path + '.profile.fullName', message: 'Missing name' })
    if (!isoDate(profile.dateOfBirth)) errors.push({ path: path + '.profile.dateOfBirth', message: 'Invalid calendar date' })
    if (!finite(profile.heightCm) || profile.heightCm < 120 || profile.heightCm > 230) {
      errors.push({ path: path + '.profile.heightCm', message: 'Height outside supported bounds' })
    }
    if (!finite(profile.massKg) || profile.massKg < 35 || profile.massKg > 180) {
      errors.push({ path: path + '.profile.massKg', message: 'Mass outside supported bounds' })
    }
    if (profile.preferredFoot !== 'left' && profile.preferredFoot !== 'right') {
      errors.push({ path: path + '.profile.preferredFoot', message: 'Invalid preferred foot' })
    }
    if (!rating(profile.weakerFoot)) errors.push({ path: path + '.profile.weakerFoot', message: 'Invalid weaker-foot rating' })
  }
  if (!isRecord(value.abilities)) {
    errors.push({ path: path + '.abilities', message: 'Missing ability groups' })
  } else {
    validateRatingSet(value.abilities.technical, TECHNICAL_ATTRIBUTES, path + '.abilities.technical', errors)
    validateRatingSet(value.abilities.mental, MENTAL_ATTRIBUTES, path + '.abilities.mental', errors)
    validateRatingSet(value.abilities.physical, PHYSICAL_ATTRIBUTES, path + '.abilities.physical', errors)
    if (value.abilities.goalkeeping !== null) {
      validateRatingSet(value.abilities.goalkeeping, GOALKEEPING_ATTRIBUTES, path + '.abilities.goalkeeping', errors)
    }
    for (const key of Object.keys(value.abilities)) {
      if (!['technical', 'mental', 'physical', 'goalkeeping'].includes(key)) {
        errors.push({ path: path + '.abilities.' + key, message: 'Unknown ability group' })
      }
    }
  }
  validateRatingSet(value.hidden, HIDDEN_CHARACTERISTICS, path + '.hidden', errors)
  if (!isRecord(value.positionFamiliarity) || Object.keys(value.positionFamiliarity).length === 0) {
    errors.push({ path: path + '.positionFamiliarity', message: 'At least one position familiarity rating is required' })
  } else {
    for (const [position, score] of Object.entries(value.positionFamiliarity)) {
      if (!POSITIONS.includes(position as (typeof POSITIONS)[number]) || !rating(score)) {
        errors.push({ path: path + '.positionFamiliarity.' + position, message: 'Invalid position or rating' })
      }
    }
  }
  if (!Array.isArray(value.tendencies)) {
    errors.push({ path: path + '.tendencies', message: 'Expected an array of tendencies' })
  } else {
    const seen = new Set<string>()
    for (const tendency of value.tendencies) {
      if (!inSet(tendency, PLAYER_TENDENCIES) || seen.has(tendency)) {
        errors.push({ path: path + '.tendencies', message: 'Unknown or repeated tendency' })
      }
      if (typeof tendency === 'string') seen.add(tendency)
    }
  }
}

function validateClub(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Expected club definition' })
    return
  }
  if (!nonEmpty(value.id)) errors.push({ path: path + '.id', message: 'Missing club ID' })
  if (!nonEmpty(value.name)) errors.push({ path: path + '.name', message: 'Missing club name' })
  if (!nonEmpty(value.shortName)) errors.push({ path: path + '.shortName', message: 'Missing short name' })
  const colors = value.colors
  if (!isRecord(colors) || !['primary', 'secondary'].every((k) =>
    typeof colors[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(colors[k]))) {
    errors.push({ path: path + '.colors', message: 'Expected two six-digit hexadecimal colors' })
  }
}

export function validateMatchSetup(input: unknown): ValidationResult<MatchSetup> {
  const errors: ValidationIssue[] = []
  if (!isRecord(input)) return { ok: false, issues: [{ path: '$', message: 'Expected match setup object' }] }

  if (input.setupVersion !== MATCH_SETUP_VERSION) {
    errors.push({ path: 'setupVersion', message: 'Unsupported match setup version' })
  }
  if (!nonEmpty(input.matchId)) errors.push({ path: 'matchId', message: 'Missing match ID' })
  if (!finite(input.seed) || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xFFFFFFFF) {
    errors.push({ path: 'seed', message: 'Expected an unsigned 32-bit seed' })
  }
  validatePitch(input.pitch, errors)

  const clubs: unknown[] = Array.isArray(input.clubs) ? input.clubs : []
  if (clubs.length !== 2) errors.push({ path: 'clubs', message: 'Exactly two clubs required' })
  const clubIds = new Set<string>()
  clubs.forEach((club, i) => {
    validateClub(club, 'clubs[' + i + ']', errors)
    if (isRecord(club) && nonEmpty(club.id)) {
      if (clubIds.has(club.id)) errors.push({ path: 'clubs[' + i + '].id', message: 'Duplicate club ID' })
      clubIds.add(club.id)
    }
  })

  const players: unknown[] = Array.isArray(input.players) ? input.players : []
  if (players.length !== 22) errors.push({ path: 'players', message: 'Exactly 22 starting player records required' })
  const playersById = new Map<string, RecordValue>()
  players.forEach((player, i) => {
    const path = 'players[' + i + ']'
    validatePlayer(player, path, errors)
    if (!isRecord(player)) return
    if (nonEmpty(player.id)) {
      if (playersById.has(player.id)) errors.push({ path: path + '.id', message: 'Duplicate player ID' })
      else playersById.set(player.id, player)
    }
    if (nonEmpty(player.clubId) && !clubIds.has(player.clubId)) {
      errors.push({ path: path + '.clubId', message: 'Player references unknown club' })
    }
  })

  const teams: unknown[] = Array.isArray(input.teams) ? input.teams : []
  if (teams.length !== 2) errors.push({ path: 'teams', message: 'Exactly two team sheets required' })
  const assignedPlayerIds = new Set<string>()
  teams.forEach((team, i) => {
    const path = 'teams[' + i + ']'
    if (!isRecord(team)) {
      errors.push({ path, message: 'Expected team sheet' })
      return
    }
    const expectedClubId = isRecord(clubs[i]) ? clubs[i].id : undefined
    if (!nonEmpty(team.clubId) || team.clubId !== expectedClubId) {
      errors.push({ path: path + '.clubId', message: 'Team sheet must match club in home/away order' })
    }
    if (team.formation !== '4-3-3') errors.push({ path: path + '.formation', message: 'Phase 0B only supports 4-3-3' })
    const starters: unknown[] = Array.isArray(team.starters) ? team.starters : []
    if (starters.length !== 11) errors.push({ path: path + '.starters', message: 'Exactly 11 starters required' })
    const slots = new Set<string>()
    const shirts = new Set<number>()
    starters.forEach((assignment, j) => {
      const entry = path + '.starters[' + j + ']'
      if (!isRecord(assignment)) {
        errors.push({ path: entry, message: 'Invalid starting assignment' })
        return
      }
      const id = assignment.playerId
      if (!nonEmpty(id) || !playersById.has(id)) {
        errors.push({ path: entry + '.playerId', message: 'Unknown player ID' })
      } else {
        if (assignedPlayerIds.has(id)) errors.push({ path: entry + '.playerId', message: 'Player assigned more than once' })
        assignedPlayerIds.add(id)
        if (playersById.get(id)?.clubId !== team.clubId) {
          errors.push({ path: entry + '.playerId', message: 'Player belongs to a different club' })
        }
      }
      const slot = assignment.slot
      if (!inSet(slot, FORMATION_433_SLOTS)) {
        errors.push({ path: entry + '.slot', message: 'Unknown 4-3-3 formation slot' })
      } else {
        if (slots.has(slot)) errors.push({ path: entry + '.slot', message: 'Duplicate formation slot' })
        slots.add(slot)
        if (!inSet(assignment.role, PLAYER_ROLES) ||
          !AVAILABLE_ROLES_BY_SLOT[slot as Formation433Slot].includes(assignment.role as PlayerRole)) {
          errors.push({ path: entry + '.role', message: 'Role is incompatible with assigned position' })
        }
        if (slot === 'GK' && isRecord(playersById.get(id as string)) &&
          !isRecord((playersById.get(id as string)?.abilities as RecordValue | undefined)?.goalkeeping)) {
          errors.push({ path: entry + '.playerId', message: 'Starting goalkeeper needs goalkeeping attributes' })
        }
      }
      if (assignment.duty !== 'defend' && assignment.duty !== 'support' && assignment.duty !== 'attack') {
        errors.push({ path: entry + '.duty', message: 'Invalid duty' })
      }
      if (slot === 'GK' && assignment.duty !== 'defend') {
        errors.push({ path: entry + '.duty', message: 'Initial goalkeeper role requires defend duty' })
      }
      const shirt = assignment.shirtNumber
      if (!Number.isInteger(shirt) || (shirt as number) < 1 || (shirt as number) > 99 || shirts.has(shirt as number)) {
        errors.push({ path: entry + '.shirtNumber', message: 'Invalid or duplicate squad number' })
      }
      if (typeof shirt === 'number') shirts.add(shirt)
    })
    for (const slot of FORMATION_433_SLOTS) {
      if (!slots.has(slot)) errors.push({ path: path + '.starters', message: 'Missing formation slot: ' + slot })
    }
  })
  for (const id of playersById.keys()) {
    if (!assignedPlayerIds.has(id)) errors.push({ path: 'players', message: 'Unassigned player: ' + id })
  }

  return errors.length ? { ok: false, issues: errors } : { ok: true, value: input as unknown as MatchSetup }
}

/** Pure, offline validation; no mutation, engine tick or randomness occurs here. */
export function assertValidMatchSetup(input: unknown): MatchSetup {
  const result = validateMatchSetup(input)
  if (!result.ok) {
    throw new Error('Invalid match setup: ' + result.issues.map((i) => i.path + ': ' + i.message).join('; '))
  }
  return result.value
}
