/**
 * The language and the .env keys.
 *
 * The restart is the part worth pinning. The keys are read once at startup
 * and handed to the store adapters, so a running Arcadia holds the old ones
 * — but restarting on a save that changed nothing would throw the user out
 * of the app for no reason. "Changed" is the whole condition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const { setLanguage, t } = await import('@shared/i18n')

describe('IPC settings channels', () => {
  let harness: Harness
  let dir: string
  let envPath: string
  let restarts: number

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  beforeEach(() => {
    handlers.clear()
    restarts = 0
    dir = mkdtempSync(join(tmpdir(), 'arcadia-env-'))
    envPath = join(dir, '.env')
    writeFileSync(envPath, '', 'utf8')

    harness = makeHarness({
      envFilePaths: [envPath],
      relaunch: () => {
        restarts += 1
      }
    })
    registerIpcHandlers(harness.context)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    // The language is process-wide state in the i18n module; left switched
    // it would leak into whichever test file runs next in this worker.
    setLanguage('en')
  })

  it('persists a language it recognises', async () => {
    await invoke(IPC.settingsSetLanguage, 'de')

    expect(harness.settings.get('language')).toBe('de')
    expect(harness.sent).toEqual([IPC.libraryChanged])
  })

  it('announces the language change so the metadata is fetched again', async () => {
    // Not decoration: the library carries metadata for one language, and
    // without the reload descriptions stay in the previous one until the
    // next scan.
    await invoke(IPC.settingsSetLanguage, 'de')
    expect(harness.sent).toContain(IPC.libraryChanged)
  })

  it('writes the keys and restarts when something changed', async () => {
    const result = (await invoke(IPC.envConfigSave, {
      STEAM_WEB_API_KEY: 'AAAABBBBCCCC',
      STEAM_ID64: '76561190000000000',
      STEAMGRIDDB_API_KEY: ''
    })) as { ok: boolean; restarting: boolean }

    expect(result.ok).toBe(true)
    expect(result.restarting).toBe(true)
    expect(restarts).toBe(1)
    expect(readFileSync(envPath, 'utf8')).toContain('AAAABBBBCCCC')
  })

  it('does not restart when the save changed nothing', async () => {
    const values = {
      STEAM_WEB_API_KEY: 'AAAABBBBCCCC',
      STEAM_ID64: '',
      STEAMGRIDDB_API_KEY: ''
    }
    await invoke(IPC.envConfigSave, values)
    restarts = 0

    const again = (await invoke(IPC.envConfigSave, values)) as { ok: boolean; restarting: boolean }

    expect(again.ok).toBe(true)
    expect(again.restarting).toBe(false)
    expect(restarts).toBe(0)
  })

  it('treats no values as a skip: answered, nothing overwritten', async () => {
    await invoke(IPC.envConfigSave, {
      STEAM_WEB_API_KEY: 'KEEPTHIS',
      STEAM_ID64: '',
      STEAMGRIDDB_API_KEY: ''
    })
    restarts = 0

    const skipped = (await invoke(IPC.envConfigSave, undefined)) as {
      ok: boolean
      restarting: boolean
    }

    expect(skipped.ok).toBe(true)
    expect(skipped.restarting).toBe(false)
    expect(restarts).toBe(0)
    expect(readFileSync(envPath, 'utf8')).toContain('KEEPTHIS')

    // "Answered" is the ENV_CONFIG_DONE marker, surfaced through
    // envConfigGet as `done` — the skip must record it just as a save does,
    // or the dialog would reopen on the next start regardless.
    const state = (await invoke(IPC.envConfigGet)) as { done: boolean }
    expect(state.done).toBe(true)
  })

  it('reads back what it wrote', async () => {
    await invoke(IPC.envConfigSave, {
      STEAM_WEB_API_KEY: 'ROUNDTRIP',
      STEAM_ID64: '',
      STEAMGRIDDB_API_KEY: ''
    })

    const state = (await invoke(IPC.envConfigGet)) as {
      values: { STEAM_WEB_API_KEY: string }
    }

    expect(state.values.STEAM_WEB_API_KEY).toBe('ROUNDTRIP')
  })

  it('does not write half a file when one value is rejected', async () => {
    await invoke(IPC.envConfigSave, {
      STEAM_WEB_API_KEY: 'GOODVALUE',
      STEAM_ID64: '',
      STEAMGRIDDB_API_KEY: ''
    })

    const before = readFileSync(envPath, 'utf8')

    const rejected = (await invoke(IPC.envConfigSave, {
      STEAM_WEB_API_KEY: 'NEWVALUE',
      STEAM_ID64: 'has\nnewline',
      STEAMGRIDDB_API_KEY: ''
    })) as { ok: boolean; error?: string }

    expect(rejected.ok).toBe(false)
    expect(rejected.error).toBe(t().errors.invalidInput)
    expect(readFileSync(envPath, 'utf8')).toBe(before)
  })
})
