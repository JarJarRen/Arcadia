/**
 * The enabled-store channels.
 *
 * Validation is the part worth pinning. The value crosses a process
 * boundary, and an unrecognised id reaching the database would come back on
 * the next start as a setting nothing can interpret.
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
const { STORE_IDS } = await import('@shared/types')

describe('IPC enabled-store channels', () => {
  let harness: Harness

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  beforeEach(() => {
    handlers.clear()
    harness = makeHarness()
    registerIpcHandlers(harness.context)
  })

  it('reports every store while nothing has been chosen', async () => {
    expect(await invoke(IPC.settingsGetStores)).toEqual([...STORE_IDS])
  })

  it('persists a selection and reads it back', async () => {
    await invoke(IPC.settingsSetStores, ['epic', 'steam'])

    expect(harness.settings.get('enabled-stores')).toBe('steam,epic')
    expect(await invoke(IPC.settingsGetStores)).toEqual(['steam', 'epic'])
  })

  it('persists an empty selection as an empty value, not as an absent row', async () => {
    await invoke(IPC.settingsSetStores, [])

    expect(harness.settings.get('enabled-stores')).toBe('')
    expect(await invoke(IPC.settingsGetStores)).toEqual([])
  })

  it('announces the change so the library is fetched again', async () => {
    await invoke(IPC.settingsSetStores, ['steam'])
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  it('ignores an argument that is not an array', async () => {
    await invoke(IPC.settingsSetStores, 'steam')
    expect(harness.settings.get('enabled-stores')).toBeUndefined()
    expect(harness.sent).toEqual([])
  })

  it('ignores a selection containing an unknown store', async () => {
    // Rejected whole rather than filtered: a renderer sending an id nothing
    // recognises is a bug, and silently saving the rest would hide it.
    await invoke(IPC.settingsSetStores, ['steam', 'gog'])
    expect(harness.settings.get('enabled-stores')).toBeUndefined()
    expect(harness.sent).toEqual([])
  })

  it('turns a database failure into a log, not a crash', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(harness.settings, 'set').mockImplementation(() => {
      throw new Error('disk full')
    })

    await invoke(IPC.settingsSetStores, ['steam'])

    expect(consoleError).toHaveBeenCalledWith(
      'Store selection could not be saved:',
      expect.any(Error)
    )
    expect(harness.sent).toEqual([])
    consoleError.mockRestore()
  })

  it('reports each adapter\'s availability, reason and limitations', async () => {
    const withAdapters = makeHarness({
      adapters: [
        {
          id: 'steam',
          displayName: 'Steam',
          isAvailable: async () => ({ available: true, limitations: ['only installed'] }),
          scanInstalled: async () => [],
          launchUri: () => '',
          installUri: () => ''
        },
        {
          id: 'epic',
          displayName: 'Epic',
          isAvailable: async () => ({ available: false, reason: 'not here' }),
          scanInstalled: async () => [],
          launchUri: () => '',
          installUri: () => ''
        }
      ]
    })
    handlers.clear()
    registerIpcHandlers(withAdapters.context)

    expect(await invoke(IPC.storesAvailability)).toEqual({
      steam: { available: true, limitations: ['only installed'] },
      epic: { available: false, reason: 'not here' }
    })
  })

  it('turns an adapter that throws while probing into an unavailable answer', async () => {
    // A probe is not worth crashing the dialog over: the store simply
    // reports itself unavailable, with the reason it threw.
    const throwing = makeHarness({
      adapters: [
        {
          id: 'ea',
          displayName: 'EA',
          isAvailable: async () => {
            throw new Error('registry locked')
          },
          scanInstalled: async () => [],
          launchUri: () => '',
          installUri: () => ''
        }
      ]
    })
    handlers.clear()
    registerIpcHandlers(throwing.context)

    expect(await invoke(IPC.storesAvailability)).toEqual({
      ea: { available: false, reason: 'registry locked' }
    })
  })
})
