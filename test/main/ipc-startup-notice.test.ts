/**
 * The channel that carries a startup failure to the window.
 *
 * Startup runs before the renderer exists, so anything that goes wrong there
 * has nowhere to report to. This existed because a damaged database used to
 * be fatal in a way nobody could read: the throw skipped
 * `registerIpcHandlers`, and the window came up with every channel missing
 * and an error naming the wrong subsystem. The database is now replaced
 * rather than allowed to be fatal — which empties the library, and an
 * unexplained empty library is its own kind of bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('IPC startup notice', () => {
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  beforeEach(() => {
    handlers.clear()
  })

  it('answers with nothing when startup went well', async () => {
    registerIpcHandlers(makeHarness().context)

    expect(await invoke(IPC.startupNotice)).toBeUndefined()
  })

  it('hands over what startup could not report at the time', async () => {
    registerIpcHandlers(makeHarness({ startupNotice: 'the database was replaced' }).context)

    expect(await invoke(IPC.startupNotice)).toBe('the database was replaced')
  })

  it('is registered even though it needs nothing from the database', async () => {
    // The point of the channel: it has to work in exactly the situation
    // where the database did not, so it must not depend on one.
    registerIpcHandlers(makeHarness({ startupNotice: 'anything' }).context)

    expect(handlers.has(IPC.startupNotice)).toBe(true)
  })
})
