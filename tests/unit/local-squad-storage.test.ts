import { describe, expect, it } from 'vitest'
import { INITIAL_LOCAL_SQUAD } from '../../src/data/initial-local-squad'
import {
  SQUAD_DATA_VERSION, SQUAD_DB_NAME, SQUAD_DB_VERSION, SQUAD_STORE_NAME,
  ensureInitialSquadSaved, isLocalSquadSeed, isStoredLocalSquad,
} from '../../src/storage/local-squad'

/**
 * Small asynchronous IDB request/transaction harness, no external package.
 * Safari's actual storage permissions and retention need an iPhone smoke test.
 */
function memoryIndexedDb() {
  const rows = new Map<string, unknown>()
  let hasStore = false
  let upgrades = 0
  let writes = 0

  function makeRequest() {
    return {
      result: undefined as unknown,
      error: null as Error | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    }
  }

  const database = {
    onversionchange: null as (() => void) | null,
    objectStoreNames: {
      contains: (name: string) => name === SQUAD_STORE_NAME && hasStore,
    },
    createObjectStore: (name: string, options: { keyPath: string }) => {
      if (name !== SQUAD_STORE_NAME || options.keyPath !== 'clubId') {
        throw new Error('Wrong object store schema')
      }
      hasStore = true
      return {} as IDBObjectStore
    },
    close: () => {},
    transaction: (_storeName: string, mode: string) => {
      if (_storeName !== SQUAD_STORE_NAME || mode !== 'readwrite') {
        throw new Error('Expected atomic write transaction')
      }
      let pending = 0
      let aborted = false
      const tx = {
        error: null as Error | null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort: () => {
          aborted = true
          queueMicrotask(() => tx.onabort?.())
        },
        objectStore: (name: string) => {
          if (name !== SQUAD_STORE_NAME) throw new Error('Wrong store')
          const schedule = (run: () => void) => {
            pending++
            queueMicrotask(() => {
              if (aborted) return
              run()
              pending--
              if (!pending) queueMicrotask(() => {
                if (!aborted) tx.oncomplete?.()
              })
            })
          }
          return {
            get: (id: string) => {
              const request = makeRequest()
              schedule(() => {
                request.result = rows.has(id) ? structuredClone(rows.get(id)) : undefined
                request.onsuccess?.()
              })
              return request as unknown as IDBRequest
            },
            add: (record: { clubId: string }) => {
              const request = makeRequest()
              schedule(() => {
                if (rows.has(record.clubId)) {
                  tx.error = new Error('ConstraintError')
                  tx.abort()
                  return
                }
                rows.set(record.clubId, structuredClone(record))
                writes++
                request.result = record.clubId
                request.onsuccess?.()
              })
              return request as unknown as IDBRequest
            },
          } as unknown as IDBObjectStore
        },
      }
      return tx as unknown as IDBTransaction
    },
  }
  const factory = {
    open: (name: string, version: number) => {
      if (name !== SQUAD_DB_NAME || version !== SQUAD_DB_VERSION) {
        throw new Error('Wrong IndexedDB name/version')
      }
      const request = makeRequest()
      request.result = database
      queueMicrotask(() => {
        if (!hasStore) {
          upgrades++
          request.onupgradeneeded?.()
        }
        request.onsuccess?.()
      })
      return request as unknown as IDBOpenDBRequest
    },
  } as unknown as IDBFactory

  return { factory, rows, get upgrades() { return upgrades }, get writes() { return writes } }
}

describe('device-only IndexedDB first-team snapshot', () => {
  it('captures Man Utd and all existing players with both distinct formation contracts', () => {
    const data = INITIAL_LOCAL_SQUAD
    expect(isLocalSquadSeed(data)).toBe(true)
    expect(data.schemaVersion).toBe(SQUAD_DATA_VERSION)
    expect(data.clubId).toBe('club_man_utd')
    expect(data.club.name).toBe('Man Utd')
    expect(data.players).toHaveLength(11)
    expect(data.players.every(p => p.clubId === data.clubId)).toBe(true)
    expect(data.engineSheet.formation).toBe('4-3-3')
    expect(data.lineupPreview.formation).toBe('4-2-3-1')
    expect(data.lineupPreview.starters).toHaveLength(11)
    expect(data.players.find(p => p.profile.fullName === 'Karim Haddad')
      ?.abilities.technical.finishing).toBe(82)
  })

  it('creates a complete snapshot once and confirms transaction completion', async () => {
    const fake = memoryIndexedDb()
    const first = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    expect(first.kind).toBe('created')
    expect(first.squad.club.name).toBe('Man Utd')
    expect(first.squad.players).toHaveLength(11)
    expect(isStoredLocalSquad(first.squad)).toBe(true)
    expect(fake.upgrades).toBe(1)
    expect(fake.writes).toBe(1)
    const second = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    expect(second.kind).toBe('existing')
    expect(second.squad).toEqual(first.squad)
    expect(fake.upgrades).toBe(1)
    expect(fake.writes).toBe(1)
  })

  it('never replaces pre-existing edited player data when app starts again', async () => {
    const fake = memoryIndexedDb()
    const first = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    const edited = {
      ...first.squad,
      players: first.squad.players.map((player, i) => i === 0
        ? { ...player, profile: { ...player.profile, fullName: 'Stored Test Keeper' } }
        : player),
    }
    fake.rows.set(first.squad.clubId, edited)
    const after = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    expect(after.kind).toBe('existing')
    expect(after.squad.players[0].profile.fullName).toBe('Stored Test Keeper')
    expect(after.squad.createdAt).toBe(first.squad.createdAt)
    expect(fake.writes).toBe(1)
  })

  it('rejects invalid existing data instead of silently resetting it', async () => {
    const fake = memoryIndexedDb()
    const first = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    const unsupported = { ...first.squad, schemaVersion: 999 }
    fake.rows.set(first.squad.clubId, unsupported)
    await expect(ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory))
      .rejects.toThrow(/preserved without overwriting/)
    expect(fake.rows.get(first.squad.clubId)).toEqual(unsupported)
    expect(fake.writes).toBe(1)
  })

  it('does not write malformed seed data or pretend IndexedDB always exists', async () => {
    const fake = memoryIndexedDb()
    const bad = { ...INITIAL_LOCAL_SQUAD, players: [] }
    expect(isLocalSquadSeed(bad)).toBe(false)
    await expect(ensureInitialSquadSaved(bad as unknown as typeof INITIAL_LOCAL_SQUAD, fake.factory))
      .rejects.toThrow(/Invalid first-team data/)
    expect(fake.writes).toBe(0)
    await expect(ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, undefined))
      .rejects.toThrow(/unavailable/)
  })
})
