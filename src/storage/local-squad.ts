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
  | { readonly kind: 'updated'; readonly squad: StoredLocalSquad }

/** One explicitly requested fictional-player replacement, not a general reset. */
export interface KnownPlayerReplacement {
  readonly previousId: string
  readonly previousFullName: string
  readonly replacementId: string
}

/**
 * Explicit, versioned club update; used only for the user-requested
 * player replacements and number changes, never a blanket seed overwrite.
 */
export interface KnownRosterUpdate {
  readonly replacements: readonly (KnownPlayerReplacement & {
    readonly previousShirtNumber: number
    readonly expectedSlot: string
  })[]
  readonly numberChanges: readonly {
    readonly playerId: string
    readonly from: number
    readonly to: number
    /**
     * An optional per-player migration gate. Required for later signings:
     * renumber just the new player while preserving previous edited numbers.
     */
    readonly onlyIfMissingPlayerIds?: readonly string[]
  }[]
  /**
   * Optional migration guard: apply legacy number changes only if at least
   * one of these replacement IDs is still missing from the ORIGINAL save.
   * This prevents a later GK import from undoing user edits to Bruno/Šeško.
   */
  readonly numberChangesOnlyIfMissingPlayerIds?: readonly string[]
}

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

/**
 * One targeted, one-time player migration. All other player objects, match
 * attributes, and save metadata are preserved. Unknown/edited replacements
 * are rejected instead of overwritten. No formation is changed.
 */
export function applyKnownPlayerReplacement(
  saved: StoredLocalSquad,
  seed: LocalSquadSeed,
  update: KnownPlayerReplacement,
): StoredLocalSquad | null {
  if (saved.clubId !== seed.clubId) throw new Error('Different club in local storage')
  const replacement = seed.players.find(p => p.id === update.replacementId)
  if (!replacement || replacement.clubId !== saved.clubId ||
    update.previousId === update.replacementId) {
    throw new Error('Requested replacement player data is invalid')
  }
  // Already imported (including a locally edited Bruno record): never reset.
  if (saved.players.some(p => p.id === update.replacementId)) return null

  const before = saved.players.filter(p => p.id === update.previousId)
  if (before.length !== 1 || before[0].profile.fullName !== update.previousFullName) {
    throw new Error('Existing player was changed; local squad preserved without overwriting')
  }
  if (saved.engineSheet.starters.filter(s => s.playerId === update.previousId).length !== 1 ||
      saved.lineupPreview.starters.filter(s => s.playerId === update.previousId).length !== 1) {
    throw new Error('Existing lineup differs; local squad preserved without overwriting')
  }
  const savedPlayer = saved.engineSheet.starters.find(s => s.playerId === update.previousId)
  const requestedPlayer = seed.engineSheet.starters.find(s => s.playerId === update.replacementId)
  if (!savedPlayer || !requestedPlayer || savedPlayer.slot !== requestedPlayer.slot ||
    savedPlayer.shirtNumber !== requestedPlayer.shirtNumber) {
    throw new Error('Existing shirt number or position changed; local squad preserved')
  }
  const updated: StoredLocalSquad = {
    ...saved,
    club: {
      ...saved.club,
      ...(seed.club.fmUid === undefined ? {} : { fmUid: seed.club.fmUid }),
    },
    players: saved.players.map(p => p.id === update.previousId ? replacement : p),
    engineSheet: {
      ...saved.engineSheet,
      starters: saved.engineSheet.starters.map(starter =>
        starter.playerId === update.previousId
          ? { ...starter, playerId: update.replacementId } : starter),
    },
    lineupPreview: {
      ...saved.lineupPreview,
      starters: saved.lineupPreview.starters.map(starter =>
        starter.playerId === update.previousId
          ? { ...starter, playerId: update.replacementId } : starter),
    },
  }
  if (!isStoredLocalSquad(updated)) {
    throw new Error('Replacement failed local roster integrity validation')
  }
  return updated
}

/**
 * Apply an explicit list of expected changes to an existing persisted team.
 * Works from either the original fictional eleven or the Bruno release,
 * and is idempotent after completion. Never deletes unknown edits or resets
 * the other players. All changes are assembled BEFORE the IndexedDB put.
 */
export function applyKnownRosterUpdate(
  original: StoredLocalSquad,
  seed: LocalSquadSeed,
  update: KnownRosterUpdate,
): StoredLocalSquad | null {
  if (original.clubId !== seed.clubId) throw new Error('Different club in local storage')
  // Once both imports exist, migration is FINISHED. Never reinterpret later
  // user-edited shirt numbers as an incomplete old-format migration.
  const allReplacementsPresent = update.replacements.every(replacement =>
    original.players.some(p => p.id === replacement.replacementId) &&
    !original.players.some(p => p.id === replacement.previousId))
  if (allReplacementsPresent) return null
  let current = original
  let modified = false

  for (const replacement of update.replacements) {
    const existing = current.players.find(p => p.id === replacement.previousId)
    const already = current.players.find(p => p.id === replacement.replacementId)
    if (already && existing) throw new Error('Conflicting old and new players; local squad preserved')
    if (already) {
      // A previous release inserted Bruno or Šeško, including any local edits.
      if (current.engineSheet.starters.filter(a => a.playerId === already.id).length !== 1 ||
        current.lineupPreview.starters.filter(a => a.playerId === already.id).length !== 1) {
        throw new Error('Existing player lineup differs; local squad preserved')
      }
      continue
    }
    const target = seed.players.find(p => p.id === replacement.replacementId)
    const oldSheet = current.engineSheet.starters.find(a => a.playerId === replacement.previousId)
    const oldPreview = current.lineupPreview.starters.find(a => a.playerId === replacement.previousId)
    const newSheet = seed.engineSheet.starters.find(a => a.playerId === replacement.replacementId)
    if (!existing || !target || existing.profile.fullName !== replacement.previousFullName ||
      target.clubId !== original.clubId ||
      !oldSheet || !oldPreview || !newSheet ||
      oldSheet.slot !== replacement.expectedSlot || newSheet.slot !== replacement.expectedSlot ||
      oldPreview.engineSlot !== replacement.expectedSlot ||
      oldSheet.shirtNumber !== replacement.previousShirtNumber ||
      oldPreview.shirtNumber !== replacement.previousShirtNumber) {
      throw new Error('Previous player or shirt number changed; local squad preserved without overwriting')
    }
    current = {
      ...current,
      players: current.players.map(p => p.id === replacement.previousId ? target : p),
      engineSheet: {
        ...current.engineSheet,
        starters: current.engineSheet.starters.map(a => a.playerId === replacement.previousId
          ? { ...a, playerId: replacement.replacementId } : a),
      },
      lineupPreview: {
        ...current.lineupPreview,
        starters: current.lineupPreview.starters.map(a => a.playerId === replacement.previousId
          ? { ...a, playerId: replacement.replacementId } : a),
      },
    }
    modified = true
  }

  const legacyNumbersNeeded = !update.numberChangesOnlyIfMissingPlayerIds ||
    update.numberChangesOnlyIfMissingPlayerIds.some(id =>
      !original.players.some(player => player.id === id))
  for (const numberChange of update.numberChanges) {
    const shouldRenumber = numberChange.onlyIfMissingPlayerIds
      ? numberChange.onlyIfMissingPlayerIds.some(id =>
          !original.players.some(player => player.id === id))
      : legacyNumbersNeeded
    if (!shouldRenumber) continue
    const oldEngine = current.engineSheet.starters.find(a => a.playerId === numberChange.playerId)
    const oldPreview = current.lineupPreview.starters.find(a => a.playerId === numberChange.playerId)
    if (!oldEngine || !oldPreview || oldEngine.shirtNumber !== oldPreview.shirtNumber ||
      (oldEngine.shirtNumber !== numberChange.from &&
        oldEngine.shirtNumber !== numberChange.to)) {
      throw new Error('Custom shirt number differs; local squad preserved without overwriting')
    }
    if (oldEngine.shirtNumber === numberChange.to) continue
    const newNumber = numberChange.to
    current = {
      ...current,
      engineSheet: {
        ...current.engineSheet,
        starters: current.engineSheet.starters.map(a => a.playerId === numberChange.playerId
          ? { ...a, shirtNumber: newNumber } : a),
      },
      lineupPreview: {
        ...current.lineupPreview,
        starters: current.lineupPreview.starters.map(a => a.playerId === numberChange.playerId
          ? { ...a, shirtNumber: newNumber } : a),
      },
    }
    modified = true
  }

  if (!modified) return null
  current = {
    ...current,
    club: { ...current.club, ...(seed.club.fmUid === undefined ? {} : { fmUid: seed.club.fmUid }) },
  }
  const engineNumbers = current.engineSheet.starters.map(a => a.shirtNumber)
  const previewNumbers = current.lineupPreview.starters.map(a => a.shirtNumber)
  if (!isStoredLocalSquad(current) ||
      new Set(engineNumbers).size !== engineNumbers.length ||
      new Set(previewNumbers).size !== previewNumbers.length ||
      current.players.some(p => p.clubId !== current.clubId)) {
    throw new Error('Roster update failed validation; local squad preserved without overwriting')
  }
  return current
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
 * Idempotent load-or-seed operation. It returns the COMMITTED active squad for
 * rendering, including a guarded import migration if one was necessary.
 * A readwrite transaction protects first-write-wins across open tabs.
 * Never silently replace a valid, edited local save with GitHub defaults.
 */
export async function ensureInitialSquadSaved(
  seed: LocalSquadSeed,
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
  replacement?: KnownPlayerReplacement | KnownRosterUpdate,
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
            if (replacement) {
              const patched = 'replacements' in replacement
                ? applyKnownRosterUpdate(existing.result, seed, replacement)
                : applyKnownPlayerReplacement(existing.result, seed, replacement)
              if (patched) {
                store.put(patched)
                result = { kind: 'updated', squad: patched }
                return
              }
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


/**
 * Stronger checks at the UI/write boundary. Keep the v1 storage envelope
 * backwards compatible while rejecting duplicate kit numbers, unpaired
 * team-sheet assignments, or invalid numerical attributes before rendering.
 */
export function isConsistentStoredSquad(squad: unknown): squad is StoredLocalSquad {
  if (!isStoredLocalSquad(squad)) return false
  const preview = new Map(squad.lineupPreview.starters.map(s => [s.playerId, s]))
  const shirtNumbers = new Set<number>()
  for (const starter of squad.engineSheet.starters) {
    const matching = preview.get(starter.playerId)
    if (!matching || matching.shirtNumber !== starter.shirtNumber ||
      matching.engineSlot !== starter.slot ||
      !Number.isInteger(starter.shirtNumber) ||
      starter.shirtNumber < 1 || starter.shirtNumber > 99 ||
      shirtNumbers.has(starter.shirtNumber)) return false
    shirtNumbers.add(starter.shirtNumber)
  }
  for (const player of squad.players) {
    for (const values of [
      player.abilities.technical, player.abilities.mental, player.abilities.physical,
      player.hidden, player.positionFamiliarity,
      ...(player.abilities.goalkeeping ? [player.abilities.goalkeeping] : []),
    ]) {
      if (Object.values(values).some(v => typeof v !== 'number' ||
        !Number.isFinite(v) || v < 0 || v > 100)) return false
    }
  }
  return preview.size === 11 && shirtNumbers.size === 11
}

/**
 * Retrieve an existing local save, without seeding, updating or modifying it.
 * Null means no record. Unsupported/corrupt records produce an error, and are
 * left untouched for recovery rather than replaced with a blank squad.
 */
export async function readStoredSquad(
  clubId: string,
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<StoredLocalSquad | null> {
  if (!nonempty(clubId)) throw new Error('Missing club ID')
  if (!factory) throw new Error('IndexedDB is unavailable in this browser')
  const db = await openSquadDatabase(factory)
  try {
    return await new Promise<StoredLocalSquad | null>((resolve, reject) => {
      let stored: StoredLocalSquad | null = null
      let tx: IDBTransaction
      try {
        tx = db.transaction(SQUAD_STORE_NAME, 'readonly')
      } catch (error) {
        reject(error)
        return
      }
      tx.oncomplete = () => resolve(stored)
      tx.onabort = () => reject(tx.error ?? new Error('Local squad read failed'))
      const request = tx.objectStore(SQUAD_STORE_NAME).get(clubId)
      request.onsuccess = () => {
        if (request.result === undefined) return
        if (!isConsistentStoredSquad(request.result) ||
          request.result.clubId !== clubId) {
          tx.abort()
          return
        }
        stored = request.result
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Future player edits must use this synchronous updater, which performs
 * read -> validate -> write inside one IndexedDB readwrite transaction.
 * No 'await' is permitted inside edit(): an async callback lets the
 * browser close its transaction and risks lost changes.
 *
 * This is persistence infrastructure, not a player-editing UI.
 */
export async function editStoredSquad(
  clubId: string,
  edit: (current: StoredLocalSquad) => StoredLocalSquad,
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<StoredLocalSquad> {
  if (!nonempty(clubId)) throw new Error('Missing club ID')
  if (!factory) throw new Error('IndexedDB is unavailable in this browser')
  const db = await openSquadDatabase(factory)
  try {
    return await new Promise<StoredLocalSquad>((resolve, reject) => {
      let updated: StoredLocalSquad | null = null
      let abortReason: Error | null = null
      let tx: IDBTransaction
      try {
        tx = db.transaction(SQUAD_STORE_NAME, 'readwrite')
      } catch (error) {
        reject(error)
        return
      }
      tx.oncomplete = () => {
        if (updated) resolve(updated)
        else reject(new Error('Squad edit was not committed'))
      }
      tx.onabort = () => reject(abortReason ?? tx.error ??
        new Error('Squad edit transaction was aborted'))
      const store = tx.objectStore(SQUAD_STORE_NAME)
      const request = store.get(clubId)
      request.onsuccess = () => {
        try {
          const current: unknown = request.result
          if (!isConsistentStoredSquad(current)) {
            throw new Error('No valid stored squad found; local data was not changed')
          }
          const next = edit(current)
          if (!isConsistentStoredSquad(next) || next.clubId !== clubId ||
            next.createdAt !== current.createdAt) {
            throw new Error('Invalid squad edit; existing local data was preserved')
          }
          store.put(next)
          updated = next
        } catch (error) {
          abortReason = error instanceof Error ? error : new Error(String(error))
          tx.abort()
        }
      }
    })
  } finally {
    db.close()
  }
}
