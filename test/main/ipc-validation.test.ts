/**
 * Every channel that takes an argument, fed rubbish.
 *
 * The arguments come from the renderer and are typed `unknown` for that
 * reason. `ipc-openfolder.test.ts` exists because this validation failed
 * once before, around shell.openExternal, where an unchecked identifier
 * reached a launch URI. This is the same guard for the other eleven
 * channels: nothing is written, nothing is launched, and the handler
 * answers rather than rejecting.
 *
 * Written as one table because the assertion is identical for all of them —
 * the interesting part is the list of channels, not the body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Static, because a type cannot be destructured out of a dynamic import.
// The value imports stay dynamic so they resolve after the electron mock.
import type { Harness } from './ipc-context'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const launched: string[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  shell: {
    showItemInFolder: (path: string) => launched.push(path),
    openExternal: async (uri: string) => {
      launched.push(uri)
      return undefined
    }
  }
}))

const { registerIpcHandlers } = await import('@main/ipc')
const { makeHarness } = await import('./ipc-context')
const { IPC } = await import('@shared/ipc')

/**
 * Rubbish per parameter type, not one list for all of them.
 *
 * A single shared list is wrong here: `true` is nonsense for a merge key
 * and perfectly valid for a favourite flag, and 42 is nonsense for a key
 * and a legitimate AppID. Feeding one list at every slot would demand that
 * the handlers reject their own valid input.
 */
const NOT_A_STRING: unknown[] = [undefined, null, 42, true, {}, [], () => undefined, Symbol('x')]

const NOT_A_BOOLEAN: unknown[] = [undefined, null, 42, 'true', {}, [], () => undefined, Symbol('x')]

/** The AppID must be a whole number, so fractions and the infinities count. */
const NOT_A_WHOLE_NUMBER: unknown[] = [undefined, null, true, '440', {}, [], 4.5, NaN, Infinity]

describe('IPC input validation', () => {
  let harness: Harness

  beforeEach(() => {
    handlers.clear()
    launched.length = 0
    harness = makeHarness()
    harness.repo.upsertScan(
      'steam',
      [{ storeGameId: '440', name: 'TF2', installed: true, installPath: process.cwd() }],
      1_700_000_000
    )
    registerIpcHandlers(harness.context)
  })

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    expect(handler, `no handler registered for ${channel}`).toBeDefined()
    return await handler!({}, ...args)
  }

  // Each entry: the channel, and the arguments after the rubbish one. The
  // rubbish is always substituted for the first argument, which is the one
  // naming a game or a key on every channel here.
  const CHANNELS: Array<[string, unknown[]]> = [
    [IPC.gameLaunch, []],
    [IPC.gameInstall, []],
    [IPC.gameSetFavorite, [true]],
    [IPC.mergeSetPreferred, ['steam:440']],
    [IPC.metadataSearch, []],
    [IPC.metadataSetMatch, [440]],
    [IPC.mergeSetSplit, [true]],
    [IPC.libraryAddManual, []],
    [IPC.libraryRemoveManual, []],
    [IPC.settingsSetLanguage, []],
    [IPC.envConfigSave, []]
  ]

  it.each(CHANNELS)('%s rejects a first argument of the wrong type', async (channel, rest) => {
    for (const nonsense of NOT_A_STRING) {
      await invoke(channel, nonsense, ...rest)
    }

    // Nothing launched, nothing opened, no library change announced.
    expect(launched).toEqual([])
    expect(harness.sent).toEqual([])
  })

  it('rejects a favourite value that is not a boolean', async () => {
    for (const nonsense of NOT_A_BOOLEAN) {
      await invoke(IPC.gameSetFavorite, 'tf2', nonsense)
    }
    expect(harness.repo.byId('steam:440')?.favorite).toBe(false)
    expect(harness.sent).toEqual([])
  })

  it('rejects a split value that is not a boolean', async () => {
    for (const nonsense of NOT_A_BOOLEAN) {
      await invoke(IPC.mergeSetSplit, 'tf2', nonsense)
    }
    expect(harness.sent).toEqual([])
  })

  it('rejects a preferred store id that is neither string nor undefined', async () => {
    // undefined is legitimate here — it resets the choice — so it is not in
    // the rubbish list for this one.
    for (const nonsense of [null, 42, true, {}, []]) {
      await invoke(IPC.mergeSetPreferred, 'tf2', nonsense)
    }
    expect(harness.sent).toEqual([])
  })

  it('rejects an AppID that is not a whole number', async () => {
    for (const nonsense of NOT_A_WHOLE_NUMBER) {
      const result = (await invoke(IPC.metadataSetMatch, 'tf2', nonsense)) as { ok: boolean }
      expect(result.ok).toBe(false)
    }
    expect(harness.sent).toEqual([])
  })

  it('rejects a manual game whose store is not one Arcadia knows', async () => {
    const result = (await invoke(IPC.libraryAddManual, {
      storeId: 'gog',
      name: 'Some Game'
    })) as { ok: boolean }

    expect(result.ok).toBe(false)
    expect(harness.repo.all().some((g) => g.name === 'Some Game')).toBe(false)
  })

  it('rejects a manual game with no name', async () => {
    for (const bad of [{ storeId: 'steam' }, { storeId: 'steam', name: 42 }]) {
      const result = (await invoke(IPC.libraryAddManual, bad)) as { ok: boolean }
      expect(result.ok).toBe(false)
    }
    expect(harness.sent).toEqual([])
  })

  it('rejects a manual store id that is present but not a string', async () => {
    const result = (await invoke(IPC.libraryAddManual, {
      storeId: 'steam',
      name: 'Some Game',
      storeGameId: 42
    })) as { ok: boolean }

    expect(result.ok).toBe(false)
  })

  it('rejects an unknown interface language', async () => {
    for (const nonsense of ['fr', 'EN', '', ...NOT_A_STRING]) {
      await invoke(IPC.settingsSetLanguage, nonsense)
    }
    expect(harness.settings.get('language')).toBeUndefined()
    expect(harness.sent).toEqual([])
  })

  it('rejects env values containing a line break', async () => {
    // A newline would end the assignment in the .env and turn the rest into
    // a variable of its own: arbitrary settings injected through a text
    // field. The file must not be half-written when this is rejected.
    const result = (await invoke(IPC.envConfigSave, {
      STEAM_WEB_API_KEY: 'AAAA\nINJECTED=1',
      STEAM_ID64: '',
      STEAMGRIDDB_API_KEY: ''
    })) as { ok: boolean; restarting: boolean }

    expect(result.ok).toBe(false)
    expect(result.restarting).toBe(false)
  })

  it('rejects an env payload missing a key entirely', async () => {
    const result = (await invoke(IPC.envConfigSave, { STEAM_WEB_API_KEY: 'AAAA' })) as {
      ok: boolean
    }
    expect(result.ok).toBe(false)
  })
})
