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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
const { t } = await import('@shared/i18n')

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

  it('returns matching suggestions once the app list is loaded', async () => {
    // Exercises the actual mapping from a found SteamApp to an
    // AppSuggestion, which an empty app list can never reach.
    const dir = mkdtempSync(join(tmpdir(), 'arcadia-ipc-applist-'))
    const cachePath = join(dir, 'steam-apps.json')
    writeFileSync(
      cachePath,
      JSON.stringify([{ appid: 1091500, name: 'Cyberpunk 2077' }]),
      'utf8'
    )
    await harness.context.appList.loadCache(cachePath)

    const results = (await invoke(IPC.metadataSearch, 'Cyberpunk')) as Array<{
      appId: number
      name: string
    }>

    expect(results).toEqual([{ appId: 1091500, name: 'Cyberpunk 2077' }])
    rmSync(dir, { recursive: true, force: true })
  })

  it('attaches metadata to the entry once it has been fetched', async () => {
    // library() reads metadata for each source in turn and stops at the
    // first one that has actually been fetched; nothing exercises that path
    // when no game in the fixture carries metadata.
    harness.metadata.upsert(
      'steam:298110',
      {
        developers: [],
        publishers: [],
        genres: ['Action'],
        screenshots: [],
        fetchAttempts: 0,
        fetchedAt: 1_700_000_000
      },
      'en'
    )

    const entries = (await invoke(IPC.libraryGet)) as Array<{
      metadata?: { genres: string[] }
    }>

    expect(entries[0]!.metadata?.genres).toEqual(['Action'])
  })

  it('reports no adapter configured, rather than throwing, when launching a known game', async () => {
    const result = (await invoke(IPC.gameLaunch, 'steam:298110')) as {
      ok: boolean
      error?: string
    }
    expect(result).toEqual({ ok: false, error: t().errors.noAdapter('steam') })
  })

  it('reports no adapter configured, rather than throwing, when installing a known game', async () => {
    const result = (await invoke(IPC.gameInstall, 'steam:298110')) as {
      ok: boolean
      error?: string
    }
    expect(result).toEqual({ ok: false, error: t().errors.noAdapter('steam') })
  })

  it('runs a sync with no adapters and announces the change', async () => {
    const result = await invoke(IPC.librarySync)

    expect(result).toEqual({ stores: [], totalGames: 0 })
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  it('applies a manual match and announces the change', async () => {
    const withFetch = makeHarness({
      fetchDetails: async () => ({
        developers: ['CD PROJEKT RED'],
        publishers: [],
        genres: [],
        screenshots: [],
        fetchAttempts: 0,
        steamAppId: 1091500
      })
    })
    withFetch.repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true }],
      1_700_000_000
    )
    handlers.clear()
    registerIpcHandlers(withFetch.context)

    const result = await invoke(IPC.metadataSetMatch, 'tf2', 1091500)

    expect(result).toEqual({ ok: true })
    expect(withFetch.sent).toEqual([IPC.libraryChanged])
    expect(withFetch.metadata.get('steam:440', 'en')?.steamAppId).toBe(1091500)
  })

  it('reports a fetch failure after the manual match is saved, distinct from a thrown error', async () => {
    // The default harness's fetchDetails resolves undefined, matching the
    // real "Steam does not know this AppID" case.
    const entries = (await invoke(IPC.libraryGet)) as Array<{ key: string }>
    const key = entries[0]!.key

    const result = await invoke(IPC.metadataSetMatch, key, 9999999)

    expect(result).toEqual({ ok: false, error: t().errors.matchSavedFetchFailed })
    // The save itself still happened, so the library still needs a reload.
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  it('answers unknownGameShort for a merge key that matches no entry', async () => {
    const result = await invoke(IPC.metadataSetMatch, 'nope', 12345)

    expect(result).toEqual({ ok: false, error: t().errors.unknownGameShort })
    expect(harness.sent).toEqual([])
  })

  it('turns a metadata failure on setMatch into a message instead of a rejection, without announcing a change', async () => {
    const broken = makeHarness({
      metadata: {
        artworkFor: () => [],
        get: () => undefined,
        setManualMatch: () => {
          throw new Error('disk full')
        }
      } as unknown as Harness['metadata']
    })
    broken.repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true }],
      1_700_000_000
    )
    handlers.clear()
    registerIpcHandlers(broken.context)

    const result = await invoke(IPC.metadataSetMatch, 'tf2', 440)

    expect(result).toEqual({ ok: false, error: t().errors.matchFailed('disk full') })
    expect(broken.sent).toEqual([])
  })

  it('turns a database failure while setting a favourite into a log, not a crash, and skips the announcement', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const entries = (await invoke(IPC.libraryGet)) as Array<{ key: string }>
    const key = entries[0]!.key
    vi.spyOn(harness.repo, 'setFavorite').mockImplementation(() => {
      throw new Error('disk full')
    })

    await invoke(IPC.gameSetFavorite, key, true)

    expect(consoleError).toHaveBeenCalledWith('Favourite could not be set:', expect.any(Error))
    expect(harness.sent).toEqual([])
    consoleError.mockRestore()
  })

  it('turns a database failure while setting the preferred store into a log, not a crash, and skips the announcement', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(harness.repo, 'setPreferredStore').mockImplementation(() => {
      throw new Error('disk full')
    })

    await invoke(IPC.mergeSetPreferred, 'tf2', 'steam:298110')

    expect(consoleError).toHaveBeenCalledWith(
      'Store choice could not be saved:',
      expect.any(Error)
    )
    expect(harness.sent).toEqual([])
    consoleError.mockRestore()
  })

  it('turns a database failure while splitting an entry into a log, not a crash, and skips the announcement', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(harness.repo, 'setSplit').mockImplementation(() => {
      throw new Error('disk full')
    })

    await invoke(IPC.mergeSetSplit, 'tf2', true)

    expect(consoleError).toHaveBeenCalledWith('Split could not be saved:', expect.any(Error))
    expect(harness.sent).toEqual([])
    consoleError.mockRestore()
  })

  it('adds a manual game with an explicit store id', async () => {
    const added = (await invoke(IPC.libraryAddManual, {
      storeId: 'steam',
      name: 'Explicit Id',
      storeGameId: '123456'
    })) as { ok: boolean; id?: string }

    expect(added).toEqual({ ok: true, id: 'steam:123456' })
  })

  it('reports a duplicate manual game by its real message, rather than a generic one', async () => {
    await invoke(IPC.libraryAddManual, { storeId: 'steam', name: 'Same Name' })

    const second = (await invoke(IPC.libraryAddManual, {
      storeId: 'steam',
      name: 'Same Name'
    })) as { ok: boolean; error?: string }

    expect(second.ok).toBe(false)
    expect(second.error).toBe('Same Name is already in the library.')
  })

  it('stringifies a non-Error thrown while adding a manual game', async () => {
    vi.spyOn(harness.repo, 'addManualGame').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'weird failure'
    })

    const result = (await invoke(IPC.libraryAddManual, {
      storeId: 'steam',
      name: 'X'
    })) as { ok: boolean; error?: string }

    expect(result).toEqual({ ok: false, error: 'weird failure' })
  })

  it('turns a database failure on install into a message instead of a rejection', async () => {
    const broken = makeHarness({
      repo: {
        byId: () => {
          throw new Error('database is locked')
        }
      } as unknown as Harness['repo']
    })
    handlers.clear()
    registerIpcHandlers(broken.context)

    const result = (await invoke(IPC.gameInstall, 'steam:298110')) as {
      ok: boolean
      error?: string
    }

    // Exact identity, not merely a substring match: the latter would still
    // pass if the handler wrapped the message through errors.launchFailed
    // instead of errors.installFailed.
    expect(result).toEqual({ ok: false, error: t().errors.installFailed('database is locked') })
  })

  it('stringifies a non-Error thrown while launching', async () => {
    const broken = makeHarness({
      repo: {
        byId: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'raw failure'
        }
      } as unknown as Harness['repo']
    })
    handlers.clear()
    registerIpcHandlers(broken.context)

    const result = (await invoke(IPC.gameLaunch, 'steam:298110')) as {
      ok: boolean
      error?: string
    }

    expect(result).toEqual({ ok: false, error: t().errors.launchFailed('raw failure') })
  })

  it('stringifies a non-Error thrown while installing', async () => {
    const broken = makeHarness({
      repo: {
        byId: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'raw failure'
        }
      } as unknown as Harness['repo']
    })
    handlers.clear()
    registerIpcHandlers(broken.context)

    const result = (await invoke(IPC.gameInstall, 'steam:298110')) as {
      ok: boolean
      error?: string
    }

    expect(result).toEqual({ ok: false, error: t().errors.installFailed('raw failure') })
  })

  it('stringifies a non-Error thrown while setting a manual match', async () => {
    const broken = makeHarness({
      metadata: {
        artworkFor: () => [],
        get: () => undefined,
        setManualMatch: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'raw failure'
        }
      } as unknown as Harness['metadata']
    })
    broken.repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true }],
      1_700_000_000
    )
    handlers.clear()
    registerIpcHandlers(broken.context)

    const result = await invoke(IPC.metadataSetMatch, 'tf2', 440)

    expect(result).toEqual({ ok: false, error: t().errors.matchFailed('raw failure') })
  })

  it('stringifies a non-Error thrown while removing a manual game', async () => {
    vi.spyOn(harness.repo, 'removeManualGame').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'weird failure'
    })

    const result = (await invoke(IPC.libraryRemoveManual, 'steam:298110')) as {
      ok: boolean
      error?: string
    }

    expect(result).toEqual({ ok: false, error: 'weird failure' })
  })
})
