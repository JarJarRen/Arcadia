/**
 * The channels that change the library, checked by their effect.
 *
 * Two things matter here beyond "it wrote something". First, a favourite is
 * set on *every* source of a merged entry — set only on the active one it
 * could never be cleared again while another source still had it. Second,
 * every write announces the change, or the interface keeps showing the old
 * library until something else happens to reload it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Harness } from './ipc-context'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  shell: { showItemInFolder: () => undefined, openExternal: async () => undefined }
}))

const { registerIpcHandlers } = await import('@main/ipc')
const { makeHarness } = await import('./ipc-context')
const { IPC } = await import('@shared/ipc')

describe('IPC library channels', () => {
  let harness: Harness

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  beforeEach(() => {
    handlers.clear()
    harness = makeHarness()
    // The real case from the development machine: one game, two stores,
    // installed only on Steam.
    harness.repo.upsertScan(
      'steam',
      [{ storeGameId: '298110', name: 'Far Cry 4', installed: true }],
      1_700_000_000
    )
    harness.repo.upsertScan(
      'ubisoft',
      [{ storeGameId: '856', name: 'Far Cry 4', installed: false }],
      1_700_000_000
    )
    registerIpcHandlers(harness.context)
  })

  it('returns one merged entry for a game owned at two stores', async () => {
    const entries = (await invoke(IPC.libraryGet)) as Array<{ name: string; sources: unknown[] }>

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Far Cry 4')
    expect(entries[0]!.sources).toHaveLength(2)
  })

  it('sets the favourite on every source, not only the active one', async () => {
    const entries = (await invoke(IPC.libraryGet)) as Array<{ key: string }>
    const key = entries[0]!.key

    await invoke(IPC.gameSetFavorite, key, true)

    expect(harness.repo.byId('steam:298110')?.favorite).toBe(true)
    expect(harness.repo.byId('ubisoft:856')?.favorite).toBe(true)
  })

  it('can clear a favourite it set', async () => {
    // The reason every source is written: with only the active one touched,
    // the merged entry would stay a favourite because the other source
    // still said so, and the star would be stuck on.
    const entries = (await invoke(IPC.libraryGet)) as Array<{ key: string }>
    const key = entries[0]!.key

    await invoke(IPC.gameSetFavorite, key, true)
    await invoke(IPC.gameSetFavorite, key, false)

    const after = (await invoke(IPC.libraryGet)) as Array<{ favorite: boolean }>
    expect(after[0]!.favorite).toBe(false)
  })

  it('ignores a favourite for a key that names no entry', async () => {
    await invoke(IPC.gameSetFavorite, 'doesnotexist', true)

    expect(harness.repo.byId('steam:298110')?.favorite).toBe(false)
    expect(harness.sent).toEqual([])
  })

  it('announces the change after every write', async () => {
    const entries = (await invoke(IPC.libraryGet)) as Array<{ key: string }>
    const key = entries[0]!.key

    await invoke(IPC.gameSetFavorite, key, true)
    await invoke(IPC.mergeSetPreferred, key, 'ubisoft:856')
    await invoke(IPC.mergeSetSplit, key, true)

    const added = (await invoke(IPC.libraryAddManual, {
      storeId: 'steam',
      name: 'A Game No Store Reports'
    })) as { ok: boolean; id?: string }
    await invoke(IPC.libraryRemoveManual, added.id)

    expect(harness.sent).toEqual([
      IPC.libraryChanged,
      IPC.libraryChanged,
      IPC.libraryChanged,
      IPC.libraryChanged,
      IPC.libraryChanged
    ])
  })

  it('splits a merged entry into two on request', async () => {
    const before = (await invoke(IPC.libraryGet)) as unknown[]
    expect(before).toHaveLength(1)

    const key = (before[0] as { key: string }).key
    await invoke(IPC.mergeSetSplit, key, true)

    const after = (await invoke(IPC.libraryGet)) as unknown[]
    expect(after).toHaveLength(2)
  })

  it('makes the chosen store the active one', async () => {
    const before = (await invoke(IPC.libraryGet)) as Array<{
      key: string
      active: { id: string }
    }>
    const key = before[0]!.key

    await invoke(IPC.mergeSetPreferred, key, 'ubisoft:856')

    const after = (await invoke(IPC.libraryGet)) as Array<{ active: { id: string } }>
    expect(after[0]!.active.id).toBe('ubisoft:856')
  })

  it('resets the store choice when handed undefined', async () => {
    const before = (await invoke(IPC.libraryGet)) as Array<{
      key: string
      active: { id: string }
    }>
    const key = before[0]!.key
    const original = before[0]!.active.id

    await invoke(IPC.mergeSetPreferred, key, 'ubisoft:856')
    await invoke(IPC.mergeSetPreferred, key, undefined)

    const after = (await invoke(IPC.libraryGet)) as Array<{ active: { id: string } }>
    expect(after[0]!.active.id).toBe(original)
  })

  it('reports an unknown game rather than throwing when launching', async () => {
    const result = (await invoke(IPC.gameLaunch, 'steam:999999')) as {
      ok: boolean
      error?: string
    }

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not known/)
  })

  it('reports an unknown game rather than throwing when installing', async () => {
    const result = (await invoke(IPC.gameInstall, 'steam:999999')) as {
      ok: boolean
      error?: string
    }

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not known/)
  })

  it('turns a database failure on launch into a message instead of a rejection', async () => {
    // Without the catch in the handler this arrives at the renderer as an
    // unhandled rejection and the button silently does nothing.
    const broken = makeHarness({
      repo: {
        byId: () => {
          throw new Error('database is locked')
        }
      } as unknown as Harness['repo']
    })
    handlers.clear()
    registerIpcHandlers(broken.context)

    const result = (await invoke(IPC.gameLaunch, 'steam:298110')) as {
      ok: boolean
      error?: string
    }

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/database is locked/)
  })

  it('adds and removes a hand-made game', async () => {
    const added = (await invoke(IPC.libraryAddManual, {
      storeId: 'steam',
      name: 'A Game No Store Reports'
    })) as { ok: boolean; id?: string }

    expect(added.ok).toBe(true)
    expect(added.id).toBeDefined()

    const withManual = (await invoke(IPC.libraryGet)) as Array<{ name: string }>
    expect(withManual.some((e) => e.name === 'A Game No Store Reports')).toBe(true)

    const removed = (await invoke(IPC.libraryRemoveManual, added.id)) as { ok: boolean }
    expect(removed.ok).toBe(true)

    const without = (await invoke(IPC.libraryGet)) as Array<{ name: string }>
    expect(without.some((e) => e.name === 'A Game No Store Reports')).toBe(false)
  })

  it('refuses to remove a game a scan found', async () => {
    const result = (await invoke(IPC.libraryRemoveManual, 'steam:298110')) as {
      ok: boolean
      error?: string
    }

    expect(result.ok).toBe(false)
    expect(harness.repo.byId('steam:298110')).toBeDefined()
  })

  it('returns nothing for a metadata search when the app list is empty', async () => {
    const results = (await invoke(IPC.metadataSearch, 'Far Cry')) as unknown[]
    expect(results).toEqual([])
  })
})
