import type { PlayerDefinition } from '../game/model/player'
import type { ClubDefinition, TeamSheet } from '../game/model/team'
import type { FirstTeamPreviewAssignment } from '../data/first-team-lineup'

/**
 * Local, device-only storage for the CURRENT Man Utd test squad.
 * Browser IndexedDB is not a GitHub or cloud backup. Schema v1 deliberately
 * stores one atomic club snapshot; it does not introduce team selection.
 */
export const SQUAD_DB_NAME = 'o11-football-manager'
export const SQUAD_DB_VERSION = 1
export const SQUAD_STORE_NAME = 'club-squads'
export const SQUAD_DATA_VERSION = 1

export interface LocalSquadSeed {
  readonly schemaVersion: typeof SQUAD_DATA_VERSION
  readonly clubId: string
  readonly club: ClubDefinition
  readonly players: readonly PlayerDefinition[]
  /** Engine contract remains 4-3-3, while the viewer is 4-2-3-1. */
  readonly engineSheet: TeamSheet
  readonly lineupPreview: {
    readonly formation: '4-2-3-1'
    readonly starters: readonly FirstTeamPreviewAssignment[]
  }
}

export interface StoredLocalSquad extends LocalSquadSeed {
  /** Recorded once, on first successful transaction. Never reset by boot. */
  readonly createdAt: string
}

export type SeedResult =
  | { readonly kind: 'created'; readonly squad: StoredLocalSquad }
  | { readonly kind: 'existing'; readonly squad: StoredLocalSquad }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const nonempty = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0

/**
 * Only accept a structurally consistent snapshot, so future code cannot
 * overwrite or claim to have loaded incomplete data. The main simulation's
 * own fixture validation remains separate from this local storage envelope.
 */
export function isLocalSquadSeed(value: unknown): value is LocalSquadSeed {
  if (!isRecord(value) || value.schemaVersion !== SQUAD_DATA_VERSION ||
    !nonempty(value.clubId) || !isRecord(value.club) ||
    value.club.id !== value.clubId || !nonempty(value.club.name) ||
    !nonempty(value.club.shortName) || !isRecord(value.club.colors) ||
    !Array.isArray(value.players) || value.players.length < 11 ||
    !isRecord(value.engineSheet) || value.engineSheet.clubId !== value.clubId ||
    value.engineSheet.formation !== '4-3-3' ||
    !Array.isArray(value.engineSheet.starters) ||
    value.engineSheet.starters.length !== 11 ||
    !isRecord(value.lineupPreview) || value.lineupPreview.formation !== '4-2-3-1' ||
    !Array.isArray(value.lineupPreview.starters) ||
    value.lineupPreview.starters.length !== 11) return false

  const players = value.players as unknown[]
  const playerIds = new Set<string>()
  for (const p of players) {
    if (!isRecord(p) || !nonempty(p.id) || p.clubId !== value.clubId ||
      !isRecord(p.profile) || !nonempty(p.profile.fullName) ||
      !isRecord(p.abilities) || !isRecord(p.hidden) ||
      !isRecord(p.abilities.technical) || !isRecord(p.abilities.mental) ||
      !isRecord(p.abilities.physical) || !isRecord(p.positionFamiliarity) ||
      !Array.isArray(p.tendencies) || playerIds.has(p.id)) return false
    playerIds.add(p.id)
  }

  const engineIds = new Set<string>()
  const previewIds = new Set<string>()
  const previewSlots = new Set<string>()
  for (const starter of value.engineSheet.starters as unknown[]) {
    if (!isRecord(starter) || !nonempty(starter.playerId) ||
      !playerIds.has(starter.playerId) || engineIds.has(starter.playerId) ||
      !nonempty(starter.slot) || !nonempty(starter.role) ||
      !nonempty(starter.duty) || typeof starter.shirtNumber !== 'number' ||
      !Number.isInteger(starter.shirtNumber)) return false
    engineIds.add(starter.playerId)
  }
  for (const starter of value.lineupPreview.starters as unknown[]) {
    if (!isRecord(starter) || !nonempty(starter.playerId) ||
      !engineIds.has(starter.playerId) || previewIds.has(starter.playerId) ||
      !nonempty(starter.slot) || previewSlots.has(starter.slot) ||
      !nonempty(starter.role) || !nonempty(starter.duty) ||
      typeof starter.shirtNumber !== 'number' ||
      !Number.isInteger(starter.shirtNumber) ||
      !isRecord(starter.position) ||
      typeof starter.position.xM !== 'number' ||
      !Number.isFinite(starter.position.xM) ||
      typeof starter.position.yM !== 'number' ||
      !Number.isFinite(starter.position.yM)) return false
    previewIds.add(starter.playerId)
    previewSlots.add(starter.slot)
  }
  return engineIds.size === 11 && previewIds.size === 11 &&
    playerIds.size >= engineIds.size
}

export function isStoredLocalSquad(value: unknown): value is StoredLocalSquad {
  return isLocalSquadSeed(value) && isRecord(value) &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
}

function openSquadDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(SQUAD_DB_NAME, SQUAD_DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQUAD_STORE_NAME)) {
        db.createObjectStore(SQUAD_STORE_NAME, { keyPath: 'clubId' })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open local squad storage'))
    request.onblocked = () => reject(new Error('Local squad database upgrade is blocked'))
  })
}

/**
 * Idempotent first-write-wins bootstrap. A single readwrite transaction
 * serializes simultaneous mounts/tabs. EXISTING records are never put,
 * cleared, deleted, or silently migrated from source-code defaults.
 *
 * For now the UI keeps using its current static preview; this method stores
 * and verifies the squad only, without introducing a team-loading feature.
 */
export async function ensureInitialSquadSaved(
  seed: LocalSquadSeed,
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<SeedResult> {
  if (!isLocalSquadSeed(seed)) throw new Error('Invalid first-team data; not writing to storage')
  if (!factory) throw new Error('IndexedDB is unavailable in this browser')

  const db = await openSquadDatabase(factory)
  try {
    return await new Promise<SeedResult>((resolve, reject) => {
      let result: SeedResult | null = null
      let abortReason: Error | null = null
      let tx: IDBTransaction
      try {
        tx = db.transaction(SQUAD_STORE_NAME, 'readwrite')
      } catch (error) {
        reject(error)
        return
      }
      tx.oncomplete = () => {
        if (result) resolve(result)
        else reject(new Error('Local squad transaction completed without a stored record'))
      }
      tx.onabort = () => reject(abortReason ?? tx.error ??
        new Error('Local squad transaction was aborted'))
      const store = tx.objectStore(SQUAD_STORE_NAME)
      const existing = store.get(seed.clubId)
      existing.onsuccess = () => {
        try {
          if (existing.result !== undefined) {
            if (!isStoredLocalSquad(existing.result)) {
              abortReason = new Error('Existing local squad has an unsupported or invalid format; preserved without overwriting')
              tx.abort()
              return
            }
            result = { kind: 'existing', squad: existing.result }
            return
          }
          const squad: StoredLocalSquad = { ...seed, createdAt: new Date().toISOString() }
          store.add(squad)
          result = { kind: 'created', squad }
        } catch (error) {
          abortReason = error instanceof Error ? error : new Error(String(error))
          tx.abort()
        }
      }
      // Request errors automatically abort this transaction; only oncomplete
      // signals that the newly written squad has actually been committed.
    })
  } finally {
    db.close()
  }
}
