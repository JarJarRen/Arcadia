import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Harness, IpcHandlers } from './ipc-context'

/**
 * A discarded image has to reach the pass that would replace it.
 *
 * The handler removes the row and deliberately does not reload the library.
 * That left the gap sitting there: the artwork pass runs once at startup, so
 * a row discarded afterwards was only replaced on the next start of the app.
 * Measured on a real library — eight games with no picture at all, each of
 * them findable on SteamGridDB.
 */

const handlers: IpcHandlers = new Map()

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
const { mergeKey } = await import('@main/library/merge')

const T0 = 1_700_000_000
const STEAM_HEADER =
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3949040/header.jpg'

describe('artwork:broken', () => {
  let harness: Harness
  let invoke: (...args: unknown[]) => Promise<void>
  let gaps: number

  beforeEach(() => {
    handlers.clear()
    gaps = 0

    harness = makeHarness({ onArtworkGap: () => gaps++ })
    harness.repo.upsertScan(
      'steam',
      [{ storeGameId: '3949040', name: 'RV There Yet?', installed: true }],
      T0
    )
    harness.metadata.upsertArtwork('steam:3949040', [{ kind: 'hero', url: STEAM_HEADER }])

    registerIpcHandlers(harness.context)

    const handler = handlers.get(IPC.artworkBroken)!
    invoke = (...args) => handler({}, ...args) as Promise<void>
  })

  it('asks for a new pass once a row is discarded', async () => {
    await invoke(mergeKey('RV There Yet?'), 'hero')

    expect(harness.metadata.artworkFor('steam:3949040')).toEqual([])
    expect(gaps).toBe(1)
  })

  it('does not ask when the report names no known game', async () => {
    await invoke(mergeKey('A Game Nobody Owns'), 'hero')

    expect(gaps).toBe(0)
  })

  it('does not ask when the kind is not one of ours', async () => {
    await invoke(mergeKey('RV There Yet?'), 'screenshot')

    expect(harness.metadata.artworkFor('steam:3949040')).toHaveLength(1)
    expect(gaps).toBe(0)
  })

  it('rejects a merge key that is not a string, asking for nothing', async () => {
    await invoke(42, 'hero')

    expect(harness.metadata.artworkFor('steam:3949040')).toHaveLength(1)
    expect(gaps).toBe(0)
  })

  it('turns a database failure while discarding artwork into a log, not a crash', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(harness.metadata, 'removeArtwork').mockImplementation(() => {
      throw new Error('disk full')
    })

    await invoke(mergeKey('RV There Yet?'), 'hero')

    expect(consoleError).toHaveBeenCalledWith(
      'Broken artwork could not be discarded:',
      expect.any(Error)
    )
    // The failure happens inside the loop, before onArtworkGap is reached.
    expect(gaps).toBe(0)
    consoleError.mockRestore()
  })
})
