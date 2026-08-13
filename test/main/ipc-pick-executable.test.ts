/**
 * The `library:pick-executable` channel, exercised through the registered
 * IPC handler rather than through `pickExecutable` directly.
 *
 * `pickExecutable` itself is covered in `pick-executable.test.ts` with a
 * `deps` object under its own control. What is not covered there is the
 * handler in `ipc.ts` that builds those deps from real Electron APIs —
 * specifically, whether a rejection from `dialog.showOpenDialog` reaches the
 * renderer as the `{ ok, error }` shape every other contract-bearing handler
 * promises, or as a rejected `invoke()` promise. The Add-game dialog built on
 * top of this channel does not wrap its own call in a try/catch, so a
 * rejection here would otherwise become an unhandled rejection with nothing
 * shown to the user.
 */
import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const showOpenDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  shell: {
    showItemInFolder: () => undefined,
    openExternal: async () => undefined,
    readShortcutLink: () => {
      throw new Error('not exercised by this test')
    }
  },
  dialog: { showOpenDialog }
}))

const { registerIpcHandlers } = await import('@main/ipc')
const { makeHarness } = await import('./ipc-context')
const { IPC } = await import('@shared/ipc')

describe('IPC pick-executable channel', () => {
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  it('turns a rejected dialog into a message instead of a rejected promise', async () => {
    handlers.clear()
    showOpenDialog.mockReset()
    showOpenDialog.mockRejectedValue(new Error('window was destroyed'))
    const harness = makeHarness()
    registerIpcHandlers(harness.context)

    const result = (await invoke(IPC.libraryPickExecutable)) as {
      ok: boolean
      error?: string
    }

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})
