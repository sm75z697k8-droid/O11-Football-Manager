import { describe, expect, it } from 'vitest'
import { selectPreviewSquadMembers } from '../../src/data/preview-squad-members'
import {
  BRUNO_REPLACEMENT, INITIAL_LOCAL_SQUAD,
  MAN_UTD_SESKO_UPDATE, MAN_UTD_LAMMENS_UPDATE,
} from '../../src/data/initial-local-squad'
import {
  SQUAD_DATA_VERSION, SQUAD_DB_NAME, SQUAD_DB_VERSION, SQUAD_STORE_NAME,
  applyKnownPlayerReplacement, applyKnownRosterUpdate, editStoredSquad,
  ensureInitialSquadSaved, isConsistentStoredSquad, isLocalSquadSeed, isStoredLocalSquad,
  readStoredSquad,
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
      if (_storeName !== SQUAD_STORE_NAME ||
        (mode !== 'readwrite' && mode !== 'readonly')) {
        throw new Error('Expected read-only or atomic write transaction')
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
            put: (record: { clubId: string }) => {
              const request = makeRequest()
              schedule(() => {
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


/** Snapshot of the previous release, containing the fictional #10 player. */
function legacySeed() {
  const previousId = BRUNO_REPLACEMENT.previousId
  const changedPlayer = INITIAL_LOCAL_SQUAD.players.map(player =>
    player.id === BRUNO_REPLACEMENT.replacementId
      ? {
          ...player, id: previousId,
          profile: { ...player.profile, fullName: BRUNO_REPLACEMENT.previousFullName },
          referenceData: undefined,
        }
      : player)
  const former = (id: string) => id === BRUNO_REPLACEMENT.replacementId ? previousId : id
  return {
    ...INITIAL_LOCAL_SQUAD,
    club: { ...INITIAL_LOCAL_SQUAD.club, fmUid: undefined },
    players: changedPlayer,
    engineSheet: {
      ...INITIAL_LOCAL_SQUAD.engineSheet,
      starters: INITIAL_LOCAL_SQUAD.engineSheet.starters.map(s => ({
        ...s, playerId: former(s.playerId),
      })),
    },
    lineupPreview: {
      ...INITIAL_LOCAL_SQUAD.lineupPreview,
      starters: INITIAL_LOCAL_SQUAD.lineupPreview.starters.map(s => ({
        ...s, playerId: former(s.playerId),
      })),
    },
  }
}


/** Build the actual previous-release shirt numbers and fictional striker,
 * retaining all other player records for migration regression testing. */
function previousBrunoReleaseSeed() {
  const oldId = 'harbor_senior_09'
  const convert = (id: string) => id === '62246208' ? oldId : id
  return {
    ...INITIAL_LOCAL_SQUAD,
    players: INITIAL_LOCAL_SQUAD.players.map(p => p.id === '62246208'
      ? {
          ...p,
          id: oldId,
          profile: { ...p.profile, fullName: 'Karim Haddad' },
          referenceData: undefined,
          abilities: { ...p.abilities, technical: { ...p.abilities.technical, finishing: 82 } },
        }
      : p),
    engineSheet: {
      ...INITIAL_LOCAL_SQUAD.engineSheet,
      starters: INITIAL_LOCAL_SQUAD.engineSheet.starters.map(a => ({
        ...a,
        playerId: convert(a.playerId),
        shirtNumber: a.playerId === '43124203' ? 10 :
          a.playerId === 'harbor_senior_08' ? 8 :
          a.playerId === '62246208' ? 9 : a.shirtNumber,
      })),
    },
    lineupPreview: {
      ...INITIAL_LOCAL_SQUAD.lineupPreview,
      starters: INITIAL_LOCAL_SQUAD.lineupPreview.starters.map(a => ({
        ...a,
        playerId: convert(a.playerId),
        shirtNumber: a.playerId === '43124203' ? 10 :
          a.playerId === 'harbor_senior_08' ? 8 :
          a.playerId === '62246208' ? 9 : a.shirtNumber,
      })),
    },
  }
}

function originalReleaseSeed() {
  const previous = previousBrunoReleaseSeed()
  const oldId = BRUNO_REPLACEMENT.previousId
  return {
    ...previous,
    players: previous.players.map(p => p.id === BRUNO_REPLACEMENT.replacementId
      ? {
          ...p, id: oldId,
          profile: { ...p.profile, fullName: BRUNO_REPLACEMENT.previousFullName },
          referenceData: undefined,
        } : p),
    engineSheet: {
      ...previous.engineSheet,
      starters: previous.engineSheet.starters.map(a => ({
        ...a, playerId: a.playerId === BRUNO_REPLACEMENT.replacementId ? oldId : a.playerId,
      })),
    },
    lineupPreview: {
      ...previous.lineupPreview,
      starters: previous.lineupPreview.starters.map(a => ({
        ...a, playerId: a.playerId === BRUNO_REPLACEMENT.replacementId ? oldId : a.playerId,
      })),
    },
  }
}


/** Old #1 on an existing iPhone, without changing the other squad entries. */
function priorSamirSnapshot<T extends { readonly players: readonly import('../../src/game/model/player').PlayerDefinition[];
  readonly engineSheet: { readonly starters: readonly import('../../src/game/model/team').StartingAssignment[] };
  readonly lineupPreview: { readonly starters: readonly import('../../src/data/first-team-lineup').FirstTeamPreviewAssignment[] };
}>(seed: T) {
  const oldId = 'harbor_senior_01'
  const currentId = '18107436'
  return {
    ...seed,
    players: seed.players.map(p => p.id === currentId ? {
      ...p, id: oldId, referenceData: undefined,
      profile: { ...p.profile, fullName: 'Samir Rahman' },
    } : p),
    engineSheet: {
      ...seed.engineSheet,
      starters: seed.engineSheet.starters.map(s => s.playerId === currentId ?
        { ...s, playerId: oldId } : s),
    },
    lineupPreview: {
      ...seed.lineupPreview,
      starters: seed.lineupPreview.starters.map(s => s.playerId === currentId ?
        { ...s, playerId: oldId } : s),
    },
  }
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
    expect(data.players.find(p => p.profile.fullName === 'Benjamin Šeško')
      ?.abilities.technical.finishing).toBe(70)
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


  it('updates only Rafiq to Bruno on an existing iPhone without resetting other players', async () => {
    const fake = memoryIndexedDb()
    const old = legacySeed()
    expect(isLocalSquadSeed(old)).toBe(true)
    const saved = await ensureInitialSquadSaved(old, fake.factory)
    expect(saved.kind).toBe('created')
    const priorKeeper = {
      ...saved.squad.players[0],
      profile: { ...saved.squad.players[0].profile, fullName: 'Edited Keeper' },
    }
    fake.rows.set(old.clubId, {
      ...saved.squad,
      players: saved.squad.players.map((p, i) => i === 0 ? priorKeeper : p),
    })
    const result = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, BRUNO_REPLACEMENT)
    expect(result.kind).toBe('updated')
    expect(result.squad.createdAt).toBe(saved.squad.createdAt)
    expect(result.squad.club.fmUid).toBe(680)
    expect(result.squad.players.map(p=>p.id)).toContain('43124203')
    expect(result.squad.players.some(p=>p.id === BRUNO_REPLACEMENT.previousId)).toBe(false)
    expect(result.squad.players[0].profile.fullName).toBe('Edited Keeper')
    expect(result.squad.players[7].profile.fullName).toBe('Bruno Fernandes')
    expect(result.squad.players[7].referenceData?.overallRating).toBe(89)
    expect(result.squad.players[7].referenceData?.potentialRating).toBe(89)
    expect(result.squad.players[7].abilities.technical.passing).toBe(90)
    expect(result.squad.players[7].hidden.naturalFitness).toBe(100)
    expect(result.squad.engineSheet.starters[7].playerId).toBe('43124203')
    expect(result.squad.lineupPreview.starters[7].playerId).toBe('43124203')
    expect(result.squad.lineupPreview.starters[7].slot).toBe('CAM')
    expect(fake.writes).toBe(2)
    const again = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, BRUNO_REPLACEMENT)
    expect(again.kind).toBe('existing')
    expect(again.squad).toEqual(result.squad)
    expect(fake.writes).toBe(2)
  })

  it('preserves edited/unknown previous CAM instead of overwriting player data', async () => {
    const old = legacySeed()
    const saved = {
      ...old,
      createdAt: '2026-11-19T00:00:00.000Z',
      players: old.players.map(p => p.id === BRUNO_REPLACEMENT.previousId
        ? { ...p, profile: { ...p.profile, fullName: 'Edited Custom Midfielder' } }
        : p),
    }
    expect(isStoredLocalSquad(saved)).toBe(true)
    expect(() => applyKnownPlayerReplacement(saved, INITIAL_LOCAL_SQUAD, BRUNO_REPLACEMENT))
      .toThrow(/preserved without overwriting/)
  })


  it('updates an existing Bruno save atomically, keeping other saved player edits intact', async () => {
    const fake = memoryIndexedDb()
    const previous = previousBrunoReleaseSeed()
    expect(isLocalSquadSeed(previous)).toBe(true)
    const original = await ensureInitialSquadSaved(previous, fake.factory)
    expect(original.kind).toBe('created')
    const changedKeeper = {
      ...original.squad.players[0],
      profile: { ...original.squad.players[0].profile, fullName: 'My Edited Keeper' },
    }
    fake.rows.set(previous.clubId, {
      ...original.squad,
      players: original.squad.players.map((p, i) => i === 0 ? changedKeeper : p),
    })
    const updated = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, MAN_UTD_SESKO_UPDATE)
    expect(updated.kind).toBe('updated')
    expect(updated.squad.createdAt).toBe(original.squad.createdAt)
    expect(updated.squad.players[0].profile.fullName).toBe('My Edited Keeper')
    expect(updated.squad.players[7]).toEqual(original.squad.players[7])
    expect(updated.squad.players[9].id).toBe('62246208')
    expect(updated.squad.players[9].referenceData?.overallRating).toBe(75)
    expect(updated.squad.players[9].referenceData?.potentialRating).toBe(85)
    expect(updated.squad.engineSheet.starters.map(a => a.shirtNumber)).toEqual(
      INITIAL_LOCAL_SQUAD.engineSheet.starters.map(a => a.shirtNumber))
    expect(updated.squad.lineupPreview.starters.map(a => a.shirtNumber)).toEqual(
      INITIAL_LOCAL_SQUAD.lineupPreview.starters.map(a => a.shirtNumber))
    expect(new Set(updated.squad.engineSheet.starters.map(a => a.shirtNumber)).size).toBe(11)
    expect(fake.writes).toBe(2)
    const unchanged = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, MAN_UTD_SESKO_UPDATE)
    expect(unchanged.kind).toBe('existing')
    expect(unchanged.squad).toEqual(updated.squad)
    expect(fake.writes).toBe(2)
  })

  it('also updates an older fictional squad with Rafiq and Karim in one save transaction', async () => {
    const fake = memoryIndexedDb()
    const old = originalReleaseSeed()
    expect(isLocalSquadSeed(old)).toBe(true)
    const first = await ensureInitialSquadSaved(old, fake.factory)
    expect(first.kind).toBe('created')
    const next = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, MAN_UTD_SESKO_UPDATE)
    expect(next.kind).toBe('updated')
    expect(next.squad.players[7].profile.fullName).toBe('Bruno Fernandes')
    expect(next.squad.players[9].profile.fullName).toBe('Benjamin Šeško')
    expect(next.squad.engineSheet.starters[6].playerId).toBe('harbor_senior_08')
    expect(next.squad.engineSheet.starters[6].shirtNumber).toBe(10)
    expect(next.squad.engineSheet.starters[7].shirtNumber).toBe(8)
    expect(next.squad.engineSheet.starters[9].shirtNumber).toBe(30)
    expect(next.squad.createdAt).toBe(first.squad.createdAt)
    expect(fake.writes).toBe(2)
  })

  it('refuses to overwrite edited striker or custom jersey number in IndexedDB', async () => {
    const saved = {
      ...previousBrunoReleaseSeed(),
      createdAt: '2026-11-19T00:00:00.000Z',
    }
    expect(isStoredLocalSquad(saved)).toBe(true)
    const changedStriker = {
      ...saved,
      players: saved.players.map(p => p.id === 'harbor_senior_09'
        ? { ...p, profile: { ...p.profile, fullName: 'Custom Striker' } } : p),
    }
    expect(() => applyKnownRosterUpdate(changedStriker, INITIAL_LOCAL_SQUAD, MAN_UTD_SESKO_UPDATE))
      .toThrow(/preserved without overwriting/)
    const customNumber = {
      ...saved,
      engineSheet: {
        ...saved.engineSheet,
        starters: saved.engineSheet.starters.map(a => a.playerId === 'harbor_senior_08'
          ? { ...a, shirtNumber: 22 } : a),
      },
      lineupPreview: {
        ...saved.lineupPreview,
        starters: saved.lineupPreview.starters.map(a => a.playerId === 'harbor_senior_08'
          ? { ...a, shirtNumber: 22 } : a),
      },
    }
    expect(() => applyKnownRosterUpdate(customNumber, INITIAL_LOCAL_SQUAD, MAN_UTD_SESKO_UPDATE))
      .toThrow(/preserved without overwriting/)
  })


  it('loads the saved record and renders edited player details, not bundled defaults', async () => {
    const fake = memoryIndexedDb()
    expect(await readStoredSquad(INITIAL_LOCAL_SQUAD.clubId, fake.factory)).toBeNull()
    const created = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    expect(created.kind).toBe('created')
    const stored = await readStoredSquad(INITIAL_LOCAL_SQUAD.clubId, fake.factory)
    expect(stored).toEqual(created.squad)
    expect(isConsistentStoredSquad(stored)).toBe(true)
    const before = selectPreviewSquadMembers(stored!)
    expect(before).toHaveLength(11)
    expect(before.find(x => x.assignment.slot === 'CAM')?.player.profile.fullName).toBe('Bruno Fernandes')
    expect(before.find(x => x.assignment.slot === 'ST')?.player.profile.fullName).toBe('Benjamin Šeško')

    const edited = await editStoredSquad(INITIAL_LOCAL_SQUAD.clubId, current => ({
      ...current,
      players: current.players.map(p => p.id === '43124203' ? {
        ...p,
        profile: { ...p.profile, fullName: 'My Local Bruno' },
        abilities: {
          ...p.abilities,
          technical: { ...p.abilities.technical, passing: 93 },
        },
      } : p),
      engineSheet: {
        ...current.engineSheet,
        starters: current.engineSheet.starters.map(p => p.playerId === '43124203'
          ? { ...p, shirtNumber: 12 } : p),
      },
      lineupPreview: {
        ...current.lineupPreview,
        starters: current.lineupPreview.starters.map(p => p.playerId === '43124203'
          ? { ...p, shirtNumber: 12 } : p),
      },
    }), fake.factory)
    expect(edited.createdAt).toBe(created.squad.createdAt)
    const afterRefresh = await readStoredSquad(INITIAL_LOCAL_SQUAD.clubId, fake.factory)
    const members = selectPreviewSquadMembers(afterRefresh!)
    const cam = members.find(m => m.assignment.slot === 'CAM')!
    expect(cam.player.profile.fullName).toBe('My Local Bruno')
    expect(cam.player.abilities.technical.passing).toBe(93)
    expect(cam.assignment.shirtNumber).toBe(12)
    expect(members.find(m => m.assignment.slot === 'ST')?.assignment.shirtNumber).toBe(30)
    expect(new Set(members.map(m => m.assignment.shirtNumber)).size).toBe(11)
    expect(fake.writes).toBe(2)

    // Reopening the app must NOT run an old shirt migration again.
    const reopened = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, MAN_UTD_SESKO_UPDATE)
    expect(reopened.kind).toBe('existing')
    expect(selectPreviewSquadMembers(reopened.squad)
      .find(m => m.assignment.slot === 'CAM')?.player.profile.fullName).toBe('My Local Bruno')
    expect(selectPreviewSquadMembers(reopened.squad)
      .find(m => m.assignment.slot === 'CAM')?.assignment.shirtNumber).toBe(12)
    expect(fake.writes).toBe(2)
  })

  it('never persists duplicate shirt numbers or invalid attribute updates', async () => {
    const fake = memoryIndexedDb()
    const original = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory)
    const playerId = original.squad.engineSheet.starters[7].playerId
    const duplicateNumber = original.squad.engineSheet.starters[0].shirtNumber
    await expect(editStoredSquad(original.squad.clubId, current => ({
      ...current,
      engineSheet: {
        ...current.engineSheet,
        starters: current.engineSheet.starters.map(p => p.playerId === playerId
          ? { ...p, shirtNumber: duplicateNumber } : p),
      },
      lineupPreview: {
        ...current.lineupPreview,
        starters: current.lineupPreview.starters.map(p => p.playerId === playerId
          ? { ...p, shirtNumber: duplicateNumber } : p),
      },
    }), fake.factory)).rejects.toThrow(/Invalid squad edit/)
    await expect(editStoredSquad(original.squad.clubId, current => ({
      ...current,
      players: current.players.map(p => p.id === playerId ? {
        ...p, abilities: {
          ...p.abilities,
          technical: { ...p.abilities.technical, passing: 101 },
        },
      } : p),
    }), fake.factory)).rejects.toThrow(/Invalid squad edit/)
    await expect(editStoredSquad(original.squad.clubId, current => ({
      ...current,
      createdAt: '2025-01-01T00:00:00.000Z',
    }), fake.factory)).rejects.toThrow(/Invalid squad edit/)
    expect(await readStoredSquad(original.squad.clubId, fake.factory)).toEqual(original.squad)
    expect(fake.writes).toBe(1)
  })

  it('retains older valid saves without rewriting new or customised player attributes', async () => {
    const fake = memoryIndexedDb()
    const before = previousBrunoReleaseSeed()
    await ensureInitialSquadSaved(before, fake.factory)
    const migrated = await ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory, MAN_UTD_SESKO_UPDATE)
    expect(migrated.kind).toBe('updated')
    const loaded = await readStoredSquad(INITIAL_LOCAL_SQUAD.clubId, fake.factory)
    expect(loaded).toEqual(migrated.squad)
    const players = selectPreviewSquadMembers(loaded!)
    expect(players.find(p => p.assignment.slot === 'ST')?.player.id).toBe('62246208')
    expect(players.find(p => p.assignment.slot === 'CAM')?.assignment.shirtNumber).toBe(8)
  })

  it('does not overwrite a readable but edited legacy squad when a known migration conflicts', async () => {
    const fake = memoryIndexedDb()
    const saved = await ensureInitialSquadSaved(previousBrunoReleaseSeed(), fake.factory)
    const edited = {
      ...saved.squad,
      players: saved.squad.players.map(p => p.id === 'harbor_senior_09' ? {
        ...p, profile: { ...p.profile, fullName: 'Custom Local Striker' },
      } : p),
    }
    fake.rows.set(saved.squad.clubId, edited)
    await expect(ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, fake.factory,
      MAN_UTD_SESKO_UPDATE)).rejects.toThrow(/preserved/)
    const recovered = await readStoredSquad(saved.squad.clubId, fake.factory)
    expect(selectPreviewSquadMembers(recovered!)
      .find(m => m.assignment.slot === 'ST')?.player.profile.fullName).toBe('Custom Local Striker')
    expect(fake.writes).toBe(1)
  })


  it('migrates Samir #1 to Lammens #1 without touching a customised Bruno and Šeško save', async () => {
    const fake=memoryIndexedDb()
    const previous=priorSamirSnapshot(INITIAL_LOCAL_SQUAD)
    expect(isLocalSquadSeed(previous)).toBe(true)
    const created=await ensureInitialSquadSaved(previous,fake.factory)
    const customised={
      ...created.squad,
      players: created.squad.players.map(p=>p.id==='43124203'
        ? { ...p, profile:{...p.profile,fullName:'Locally Customised Bruno'} }
        : p),
      engineSheet: {
        ...created.squad.engineSheet,
        starters: created.squad.engineSheet.starters.map(p=>p.playerId==='43124203'
          ? {...p,shirtNumber:12} : p),
      },
      lineupPreview: {
        ...created.squad.lineupPreview,
        starters: created.squad.lineupPreview.starters.map(p=>p.playerId==='43124203'
          ? {...p,shirtNumber:12} : p),
      },
    }
    fake.rows.set(customised.clubId,customised)
    expect(isStoredLocalSquad(customised)).toBe(true)
    const migrated=await ensureInitialSquadSaved(
      INITIAL_LOCAL_SQUAD,fake.factory,MAN_UTD_LAMMENS_UPDATE)
    expect(migrated.kind).toBe('updated')
    expect(migrated.squad.createdAt).toBe(created.squad.createdAt)
    expect(migrated.squad.players[0].id).toBe('18107436')
    expect(migrated.squad.players[0].profile.fullName).toBe('Senne Lammens')
    expect(migrated.squad.players[0].referenceData?.overallRating).toBe(77)
    expect(migrated.squad.players[0].referenceData?.potentialRating).toBe(83)
    expect(migrated.squad.players.slice(1)).toEqual(customised.players.slice(1))
    expect(migrated.squad.engineSheet.starters[0].shirtNumber).toBe(1)
    expect(migrated.squad.lineupPreview.starters[0].shirtNumber).toBe(1)
    expect(migrated.squad.engineSheet.starters[7].shirtNumber).toBe(12)
    expect(migrated.squad.lineupPreview.starters[7].shirtNumber).toBe(12)
    expect(selectPreviewSquadMembers(migrated.squad).find(m=>m.assignment.slot==='CAM')
      ?.player.profile.fullName).toBe('Locally Customised Bruno')
    expect(fake.writes).toBe(2)
    const reopened=await ensureInitialSquadSaved(
      INITIAL_LOCAL_SQUAD,fake.factory,MAN_UTD_LAMMENS_UPDATE)
    expect(reopened.kind).toBe('existing')
    expect(reopened.squad).toEqual(migrated.squad)
    expect(fake.writes).toBe(2)
  })

  it('upgrades a pre-Bruno/Šeško/Samir save atomically into three real players', async () => {
    const fake=memoryIndexedDb()
    const previous=priorSamirSnapshot(originalReleaseSeed())
    expect(isLocalSquadSeed(previous)).toBe(true)
    const created=await ensureInitialSquadSaved(previous,fake.factory)
    const migrated=await ensureInitialSquadSaved(
      INITIAL_LOCAL_SQUAD,fake.factory,MAN_UTD_LAMMENS_UPDATE)
    expect(migrated.kind).toBe('updated')
    expect(migrated.squad.createdAt).toBe(created.squad.createdAt)
    expect(migrated.squad.players[0].id).toBe('18107436')
    expect(migrated.squad.players[7].id).toBe('43124203')
    expect(migrated.squad.players[9].id).toBe('62246208')
    expect(migrated.squad.engineSheet.starters.map(s=>s.shirtNumber)).toEqual(
      INITIAL_LOCAL_SQUAD.engineSheet.starters.map(s=>s.shirtNumber))
    expect(new Set(migrated.squad.engineSheet.starters.map(s=>s.shirtNumber)).size).toBe(11)
    expect(fake.writes).toBe(2)
  })

  it('protects an edited Samir record instead of discarding it', async () => {
    const fake=memoryIndexedDb()
    const old=priorSamirSnapshot(INITIAL_LOCAL_SQUAD)
    const created=await ensureInitialSquadSaved(old,fake.factory)
    const customised={
      ...created.squad,
      players: created.squad.players.map(p=>p.id==='harbor_senior_01'
        ? {...p,profile:{...p.profile,fullName:'My Edited Keeper'}} : p),
    }
    fake.rows.set(old.clubId,customised)
    await expect(ensureInitialSquadSaved(
      INITIAL_LOCAL_SQUAD,fake.factory,MAN_UTD_LAMMENS_UPDATE))
      .rejects.toThrow(/preserved without overwriting/)
    const saved=await readStoredSquad(old.clubId,fake.factory)
    expect(saved?.players[0].profile.fullName).toBe('My Edited Keeper')
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
