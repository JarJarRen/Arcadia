import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
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

const { openDatabase } = await import('@main/db/schema')
const { GameRepository } = await import('@main/db/repository')
const { MetadataRepository } = await import('@main/db/metadata')
const { SettingsRepository } = await import('@main/db/settings')
const { registerIpcHandlers } = await import('@main/ipc')
const { SteamAppList } = await import('@main/metadata/steamAppList')
const { IPC } = await import('@shared/ipc')

describe('game:open-folder', () => {
  let invoke: (...args: unknown[]) => Promise<{ ok: boolean; error?: string }>

  beforeEach(() => {
    handlers.clear()
    opened.length = 0

    const db = openDatabase(':memory:')
    const repo = new GameRepository(db)
    repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true, installPath: 'F:\\games\\tf2' }],
      1_700_000_000
    )

    registerIpcHandlers({
      repo,
      metadata: new MetadataRepository(db),
      settings: new SettingsRepository(db),
      adapters: [],
      appList: new SteamAppList(),
      fetchDetails: async () => undefined,
      getWindow: () => undefined,
      envFilePaths: [],
      relaunch: () => undefined
    })

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
    const db = openDatabase(':memory:')
    const repo = new GameRepository(db)
    repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true, installPath: process.cwd() }],
      1_700_000_000
    )
    handlers.clear()
    registerIpcHandlers({
      repo,
      metadata: new MetadataRepository(db),
      settings: new SettingsRepository(db),
      adapters: [],
      appList: new SteamAppList(),
      fetchDetails: async () => undefined,
      getWindow: () => undefined,
      envFilePaths: [],
      relaunch: () => undefined
    })

    const result = (await handlers.get(IPC.gameOpenFolder)!({}, 'tf2')) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(opened).toEqual([process.cwd()])
  })
})
