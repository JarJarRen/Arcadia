/**
 * An IpcContext over an in-memory database.
 *
 * Extracted rather than repeated per test file: the context has ten fields,
 * and a test that constructs it by hand goes stale the moment an eleventh
 * arrives — silently, as a type error in one file nobody is reading.
 *
 * Deliberately no `vi.mock('electron')` here. The mock has to be declared in
 * the file that imports `@main/ipc`, so each test file keeps its own.
 */
import type { BrowserWindow } from 'electron'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { SettingsRepository } from '@main/db/settings'
import { SteamAppList } from '@main/metadata/steamAppList'
import { createScanState } from '@main/scan-state'
import { FreebieRepository } from '@main/db/freebies'
import { FreebieService } from '@main/freebies/service'
import { IPC } from '@shared/ipc'
import type { IpcContext } from '@main/ipc'

/**
 * The shape every test file's own `handlers` map takes. Exported so the type
 * signature — repeated once per file because the map itself has to live
 * beside its `vi.mock('electron')` factory — need not be retyped each time.
 */
export type IpcHandlers = Map<string, (event: unknown, ...args: unknown[]) => unknown>

export interface Harness {
  db: ReturnType<typeof openDatabase>
  repo: GameRepository
  metadata: MetadataRepository
  settings: SettingsRepository
  /** Channels the handlers pushed to the renderer, in order. */
  sent: string[]
  /**
   * The same events as `sent`, paired with whatever arguments accompanied
   * them.
   *
   * Kept separate from `sent` rather than replacing it: most tests only care
   * which channels fired, and changing `sent`'s element type would force
   * every one of those `toContain(IPC.whatever)` assertions to be rewritten
   * for no benefit. This is for the minority that need the payload too —
   * `microsoft:auth-changed`'s error string, for one.
   */
  sentWithArgs: Array<{ channel: string; args: unknown[] }>
  context: IpcContext
}

export function makeHarness(overrides: Partial<IpcContext> = {}): Harness {
  const db = openDatabase(':memory:')
  const repo = new GameRepository(db)
  const metadata = new MetadataRepository(db)
  const settings = new SettingsRepository(db)
  const freebiesRepo = new FreebieRepository(db)
  const sent: string[] = []
  const sentWithArgs: Array<{ channel: string; args: unknown[] }> = []

  const context: IpcContext = {
    repo,
    metadata,
    settings,
    adapters: [],
    // A real repository over the same in-memory database, so the
    // confirmation hook run after every `runSync` in the handlers under
    // test has something real to query rather than a stub that would hide
    // a wiring mistake.
    freebiesRepo,
    freebies: new FreebieService({
      repo: freebiesRepo,
      settings,
      locale: () => ({ language: 'en', country: 'US' })
    }),
    // A real one, not a stub: it is a counter and a callback with no
    // dependencies, and the genuine article keeps the handlers' scan
    // bookkeeping under test. Its transitions land in `sent` beside the
    // library:changed notifications, in the order they happened.
    scan: createScanState((scanning) => {
      sent.push(`${IPC.libraryScanning}:${String(scanning)}`)
      sentWithArgs.push({ channel: `${IPC.libraryScanning}:${String(scanning)}`, args: [] })
    }),
    appList: new SteamAppList(),
    fetchDetails: async () => undefined,
    // A fake window, so notifyChanged is observable. The handlers only ever
    // reach webContents.send, so nothing else needs to exist.
    getWindow: () =>
      ({
        webContents: {
          send: (channel: string, ...args: unknown[]) => {
            sent.push(channel)
            sentWithArgs.push({ channel, args })
          }
        }
      }) as unknown as BrowserWindow,
    envFilePaths: [],
    relaunch: () => undefined,
    ...overrides
  }

  return { db, repo, metadata, settings, sent, sentWithArgs, context }
}
