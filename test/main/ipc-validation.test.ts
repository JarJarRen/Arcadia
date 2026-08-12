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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
// For asserting which error came back, not just that one did — see the
// discrimination tests below.
const { t } = await import('@shared/i18n')

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

  /**
   * Discrimination tests.
   *
   * `context.adapters` is empty and the merge key never matches, so these
   * four channels answer with an error whether or not their first-argument
   * guard exists — "nothing launched, nothing sent" is guaranteed either
   * way. What only the guard produces is the *particular* error below; take
   * it away and the handler falls through to a different one instead. That
   * difference, not the empty side effects, is what proves the guard ran.
   */

  it('answers invalidGameId, not the unknown-game error, when the launch id is the wrong type', async () => {
    for (const nonsense of NOT_A_STRING) {
      const result = (await invoke(IPC.gameLaunch, nonsense)) as { ok: boolean; error?: string }
      expect(result.error).toBe(t().errors.invalidGameId)
    }
  })

  it('answers invalidGameId, not the unknown-game error, when the install id is the wrong type', async () => {
    for (const nonsense of NOT_A_STRING) {
      const result = (await invoke(IPC.gameInstall, nonsense)) as { ok: boolean; error?: string }
      expect(result.error).toBe(t().errors.invalidGameId)
    }
  })

  it('answers invalidGameId, not the thrown unknown-game message, when the removal id is the wrong type', async () => {
    for (const nonsense of NOT_A_STRING) {
      const result = (await invoke(IPC.libraryRemoveManual, nonsense)) as {
        ok: boolean
        error?: string
      }
      expect(result.error).toBe(t().errors.invalidGameId)
    }
  })

  it('answers invalidInput, not unknownGameShort, when the match merge key is the wrong type', async () => {
    for (const nonsense of NOT_A_STRING) {
      const result = (await invoke(IPC.metadataSetMatch, nonsense, 440)) as {
        ok: boolean
        error?: string
      }
      expect(result.error).toBe(t().errors.invalidInput)
    }
  })

  it('answers invalidInput with restarting false for an env payload that is not an object', async () => {
    for (const nonsense of [42, true, 'a string', Symbol('x'), () => undefined]) {
      const result = (await invoke(IPC.envConfigSave, nonsense)) as {
        ok: boolean
        error?: string
        restarting: boolean
      }
      expect(result.ok).toBe(false)
      expect(result.error).toBe(t().errors.invalidInput)
      expect(result.restarting).toBe(false)
    }
  })

  /**
   * Two guards are missing from the discrimination tests above, and that is
   * not an oversight.
   *
   * `gameSetFavorite`'s `typeof mergeKey !== 'string'` half is wholly
   * subsumed by the lookup three lines below it in `ipc.ts`, which compares
   * `mergeKey` against known keys with `===`; a key that is always a string
   * can never equal a non-string, so a missing merge key and a wrong-typed
   * one are indistinguishable no-ops. There is no error to discriminate on,
   * so no test can tell the guard's absence from its presence.
   *
   * `envConfigSave`'s `typeof values !== 'object'` guard is shadowed the
   * same way: every non-object this suite (or the real renderer) can send
   * ends up with `undefined` from property access rather than a throw, so
   * the per-key loop beneath it already returns `'invalid'` on its own.
   * Deleting the guard changes nothing observable.
   *
   * Both guards stay in `ipc.ts` regardless — they state the contract where
   * a reader looks for it, and cheaply, and either could become load-bearing
   * if the code beneath it changes shape. They are just not provably tested
   * here, and this suite passing green must not be read as claiming they
   * are.
   */

  /**
   * Counter-cases.
   *
   * `expect(sent).toEqual([])` above only means something if `sent` can
   * become non-empty at all. These three are that proof: valid input for
   * the same channels, checked against the repository write and the
   * announcement the rejections above must NOT produce.
   */

  it('writes the favourite and announces the change for a valid merge key', async () => {
    await invoke(IPC.gameSetFavorite, 'tf2', true)
    expect(harness.repo.byId('steam:440')?.favorite).toBe(true)
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  it('announces the change for a valid preferred-store choice', async () => {
    await invoke(IPC.mergeSetPreferred, 'tf2', 'steam:440')
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  it('announces the change for a valid split choice', async () => {
    await invoke(IPC.mergeSetSplit, 'tf2', true)
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  describe('envConfigSave against a real file', () => {
    // A skip has to actually succeed to be a skip. The default harness
    // points envFilePaths at nothing, so a save — even one with nothing to
    // write — fails at the filesystem rather than proving the distinction
    // this is meant to pin. A real, writable file is required to tell
    // "rejected" apart from "skipped".
    let directory: string

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'arcadia-ipc-validation-'))
      const local = makeHarness({ envFilePaths: [join(directory, 'checkout.env')] })
      registerIpcHandlers(local.context)
    })

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true })
    })

    it('treats undefined and null as a skip, not a rejection', async () => {
      for (const skip of [undefined, null]) {
        const result = (await invoke(IPC.envConfigSave, skip)) as {
          ok: boolean
          restarting: boolean
        }
        expect(result.ok).toBe(true)
        expect(result.restarting).toBe(false)
      }
    })
  })

  describe('adding a storeless game', () => {
    let dir: string
    let existingExe: string

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'arcadia-exe-'))
      existingExe = join(dir, process.platform === 'win32' ? 'mc.exe' : 'mc')
      writeFileSync(existingExe, '')
    })

    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('records the program and its arguments', async () => {
      const result = await invoke(IPC.libraryAddManual, {
        storeId: 'other',
        name: 'Minecraft Launcher',
        launchExe: existingExe,
        launchArgs: ['--offline']
      })

      expect(result).toMatchObject({ ok: true })
    })

    it('refuses arguments that are not a list of strings', async () => {
      const result = await invoke(IPC.libraryAddManual, {
        storeId: 'other',
        name: 'X',
        launchExe: existingExe,
        launchArgs: [1, 2]
      })
      expect(result).toMatchObject({ ok: false })
    })

    it('refuses a program that is not on this machine', async () => {
      const result = await invoke(IPC.libraryAddManual, {
        storeId: 'other',
        name: 'X',
        launchExe: 'C:\\nowhere\\nothing.exe'
      })
      // Checked again here rather than trusting the picker: the renderer can
      // call this channel with anything, wherever the path came from.
      expect(result).toMatchObject({ ok: false })
    })

    it('refuses a relative path', async () => {
      const result = await invoke(IPC.libraryAddManual, {
        storeId: 'other',
        name: 'X',
        launchExe: 'mc.exe'
      })
      expect(result).toMatchObject({ ok: false })
    })

    it('trims surrounding whitespace from the program path before storing it', async () => {
      const result = (await invoke(IPC.libraryAddManual, {
        storeId: 'other',
        name: 'Padded Launcher',
        launchExe: `  ${existingExe}  `
      })) as { ok: boolean; id?: string }

      expect(result).toMatchObject({ ok: true })
      const stored = harness.repo.byId(result.id!)
      expect(stored?.launchExe).toBe(existingExe)
    })

    it('refuses a whitespace-only program on the storeless store', async () => {
      const result = await invoke(IPC.libraryAddManual, {
        storeId: 'other',
        name: 'Blank Launcher',
        launchExe: '   '
      })

      // Whitespace collapses to no program at all, and the storeless store
      // is the one store that needs one — the repository's own rule is what
      // refuses this, not a check on the raw string here.
      expect(result).toMatchObject({ ok: false })
    })

    it('drops a whitespace-only program on a store other than the storeless one', async () => {
      const result = (await invoke(IPC.libraryAddManual, {
        storeId: 'steam',
        name: 'Blank Steam Entry',
        launchExe: '   '
      })) as { ok: boolean; id?: string }

      // Whitespace collapses to `undefined` before the mirrored rule (a
      // program is only for the storeless store) is ever evaluated, so this
      // is accepted with the field simply dropped — not refused for
      // carrying a program it shouldn't.
      expect(result).toMatchObject({ ok: true })
      const stored = harness.repo.byId(result.id!)
      expect(stored?.launchExe).toBeUndefined()
    })
  })
})
