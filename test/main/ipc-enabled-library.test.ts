/**
 * What a switched-off store does to the library.
 *
 * Rows are kept, not deleted, so switching a store back on restores its
 * games with favourites and merge choices intact. The filtering happens
 * BEFORE mergeLibrary — that is what lets a game owned on two stores lose
 * only the switched-off source and stay one entry under the other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Harness } from './ipc-context'
import type { LibraryEntry } from '@shared/library'

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

describe('the library and the enabled stores', () => {
  let harness: Harness

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  const games = async (): Promise<LibraryEntry[]> =>
    (await invoke(IPC.libraryGet)) as LibraryEntry[]

  beforeEach(() => {
    handlers.clear()
    harness = makeHarness()
    registerIpcHandlers(harness.context)

    harness.repo.upsertScan('steam', [{ storeGameId: '10', name: 'Portal', installed: true }], 1)
    harness.repo.upsertScan('epic', [{ storeGameId: 'e1', name: 'Control', installed: true }], 1)
  })

  it('shows every store while nothing has been chosen', async () => {
    expect((await games()).map((entry) => entry.name).sort()).toEqual(['Control', 'Portal'])
  })

  it('hides the games of a switched-off store', async () => {
    await invoke(IPC.settingsSetStores, ['steam'])

    expect((await games()).map((entry) => entry.name)).toEqual(['Portal'])
  })

  it('keeps the rows, so switching the store back on restores them', async () => {
    await invoke(IPC.settingsSetStores, ['steam'])
    await invoke(IPC.settingsSetStores, ['steam', 'epic'])

    expect((await games()).map((entry) => entry.name).sort()).toEqual(['Control', 'Portal'])
  })

  it('keeps a game owned on two stores under the store that is still on', async () => {
    // Same name, so mergeLibrary joins them into one entry with two sources.
    harness.repo.upsertScan('epic', [{ storeGameId: 'e2', name: 'Portal', installed: true }], 2)
    await invoke(IPC.settingsSetStores, ['steam'])

    const entries = await games()
    const portal = entries.find((entry) => entry.name === 'Portal')

    expect(portal).toBeDefined()
    expect(portal!.sources.map((source) => source.storeId)).toEqual(['steam'])
  })

  it('shows nothing at all when every store is switched off', async () => {
    await invoke(IPC.settingsSetStores, [])

    expect(await games()).toEqual([])
  })
})
