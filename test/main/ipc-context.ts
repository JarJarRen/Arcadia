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
  context: IpcContext
}

export function makeHarness(overrides: Partial<IpcContext> = {}): Harness {
  const db = openDatabase(':memory:')
  const repo = new GameRepository(db)
  const metadata = new MetadataRepository(db)
  const settings = new SettingsRepository(db)
  const sent: string[] = []

  const context: IpcContext = {
    repo,
    metadata,
    settings,
    adapters: [],
    appList: new SteamAppList(),
    fetchDetails: async () => undefined,
    // A fake window, so notifyChanged is observable. The handlers only ever
    // reach webContents.send, so nothing else needs to exist.
    getWindow: () =>
      ({ webContents: { send: (channel: string) => sent.push(channel) } }) as unknown as BrowserWindow,
    envFilePaths: [],
    relaunch: () => undefined,
    ...overrides
  }

  return { db, repo, metadata, settings, sent, context }
}
