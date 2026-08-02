import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Harness, IpcHandlers } from './ipc-context'

/**
 * Checks by behaviour, not by source text, that the folder channel does not
 * open a path supplied by the renderer.
 *
 * Why this is a test of its own: the same bug was found once before, back
 * then around `shell.openExternal`. An identifier from a store file ended
 * up unchecked in a launch URI. Here the consequence would be worse:
 * `showItemInFolder` opens the file manager anywhere on the system, and the
 * call would look unremarkable in the log.
 *
 * The protection is the signature itself — the channel takes the merge key
 * and looks the path up in the database. This test pins that down.
 */

const handlers: IpcHandlers = new Map()
const opened: string[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  shell: {
    showItemInFolder: (path: string) => opened.push(path),
    openExternal: async () => undefined
  }
}))

const { registerIpcHandlers } = await import('@main/ipc')
const { makeHarness } = await import('./ipc-context')
const { IPC } = await import('@shared/ipc')

describe('game:open-folder', () => {
  let harness: Harness
  let invoke: (...args: unknown[]) => Promise<{ ok: boolean; error?: string }>

  beforeEach(() => {
    handlers.clear()
    opened.length = 0

    harness = makeHarness()
    harness.repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true, installPath: 'F:\\games\\tf2' }],
      1_700_000_000
    )

    registerIpcHandlers(harness.context)

    const handler = handlers.get(IPC.gameOpenFolder)!
    invoke = (...args) => handler({}, ...args) as Promise<{ ok: boolean; error?: string }>
  })

  it('does not open a path that was handed in', async () => {
    // The heart of the matter: a valid path sits here, and still nothing
    // may be opened — it is not a merge key.
    const result = await invoke('C:\\Windows\\System32')

    expect(opened).toEqual([])
    expect(result.ok).toBe(false)
  })

  it('does not open the path of another game either', async () => {
    // A key that does not exist must not lead to some other folder being
    // opened.
    await invoke('doesnotexist')
    expect(opened).toEqual([])
  })

  it('rejects anything that is not a string', async () => {
    for (const nonsense of [undefined, null, 42, { path: 'C:\\' }, ['C:\\']]) {
      const result = await invoke(nonsense)
      expect(result.ok).toBe(false)
    }
    expect(opened).toEqual([])
  })

  it('reports a folder that is gone instead of silently doing nothing', async () => {
    // showItemInFolder does nothing, silently, for a dead path. Without
    // this message the button would look broken when in truth the game was
    // uninstalled outside the app.
    const result = await invoke('tf2')

    expect(opened).toEqual([])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer exists/)
  })

  it('opens the looked-up path when it really is there', async () => {
    // The counter-check: without it the test would also pass if the channel
    // simply never opened anything.
    const second = makeHarness()
    second.repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true, installPath: process.cwd() }],
      1_700_000_000
    )
    handlers.clear()
    registerIpcHandlers(second.context)

    const result = (await handlers.get(IPC.gameOpenFolder)!({}, 'tf2')) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(opened).toEqual([process.cwd()])
  })
})
