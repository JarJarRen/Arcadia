import { ipcMain, screen, shell, type BrowserWindow } from 'electron'
import { stat } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import { getLanguage, parseLanguage, setLanguage, t } from '@shared/i18n'
import { STORE_IDS, type StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'
import type { ArtworkRef, GameMetadata } from '@shared/metadata'
import type { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import type { SettingsRepository } from '@main/db/settings'
import type { StoreAdapter } from '@main/stores/types'
import { mergeLibrary } from '@main/library/merge'
import { runSync } from '@main/sync'
import { cancelInstall, installGame, launchGame, type InstallFrame } from '@main/launch-bridge'
import { decodeWindowHandle } from '@main/platform/windows'
import type { SteamAppList } from '@main/metadata/steamAppList'
import { applyManualMatch } from '@main/metadata/queue'
import { readEnvConfig, saveEnvConfig } from '@main/env-config'
import { envValueIsWritable } from '@main/env-file'
import { ENV_CONFIG_KEYS, type EnvConfigValues } from '@shared/env-config'

export interface IpcContext {
  repo: GameRepository
  metadata: MetadataRepository
  settings: SettingsRepository
  adapters: StoreAdapter[]
  getWindow: () => BrowserWindow | undefined
  /**
   * The loaded Steam app list, shared with the background service.
   *
   * Shared rather than loaded twice: the list holds 176,000 entries and
   * 7.6 MB. A second copy just for the search would be pure waste.
   */
  appList: SteamAppList
  /** Fetches the details for an AppID — for the immediate correction. */
  fetchDetails: (appId: number) => Promise<GameMetadata | undefined>
  /**
   * The `.env` files, in the order dotenv loads them.
   *
   * Handed in rather than derived here: `app.getPath('userData')` is only
   * meaningful once Electron is ready, and the handlers are registered by a
   * process that already knows both paths.
   */
  envFilePaths: string[]
  /**
   * Restarts the app after the keys changed.
   *
   * The keys are read once at startup and handed to the store adapters, so
   * a running Arcadia holds the old ones. Injected rather than called
   * directly so the handlers stay free of `app`.
   */
  relaunch: () => void
  /**
   * Called when a broken image has been discarded and a gap now stands open.
   *
   * Optional because the handlers work without it — the gap would just wait
   * for the next start of the app, which is the behaviour this replaces.
   */
  onArtworkGap?: () => void
}

/**
 * Builds the library as the interface sees it.
 *
 * Artwork and metadata are attached here, not in `mergeLibrary` — that way
 * the merge stays free of database access and testable without a database.
 *
 * The active store entry is consulted first, then the remaining sources:
 * for a merged game the image can hang off the Epic row while Steam is the
 * active store.
 */
function library(repo: GameRepository, metadata: MetadataRepository): LibraryEntry[] {
  return mergeLibrary(repo.all(), repo.readMergeOverrides()).map((entry) => {
    const order = [entry.active, ...entry.sources.filter((s) => s.id !== entry.active.id)]

    let artwork: ArtworkRef[] = []
    for (const source of order) {
      const found = metadata.artworkFor(source.id)
      if (found.length > 0) {
        artwork = found
        break
      }
    }

    let meta: GameMetadata | undefined
    for (const source of order) {
      const found = metadata.get(source.id, getLanguage())
      if (found?.fetchedAt !== undefined) {
        meta = found
        break
      }
    }

    return { ...entry, artwork, ...(meta === undefined ? {} : { metadata: meta }) }
  })
}

/**
 * Arcadia's window as the agent needs to see it.
 *
 * `dipToScreenRect` rather than the raw bounds: `getBounds` is in
 * device-independent pixels while user32 works in physical ones. On a
 * monitor at 150 % those differ, and an unconverted rectangle centres the
 * dialog somewhere else entirely.
 */
function installFrame(window: BrowserWindow | undefined): InstallFrame | undefined {
  if (window === undefined || window.isDestroyed()) return undefined

  const rect = screen.dipToScreenRect(window, window.getBounds())

  return {
    target: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    // Decoded by a tested function rather than inline: this whole helper
    // needs a live BrowserWindow and so cannot be reached from vitest, and
    // the handle read is the only part of it with anything to get wrong.
    owner: decodeWindowHandle(window.getNativeWindowHandle())
  }
}

export function registerIpcHandlers(context: IpcContext): void {
  const notifyChanged = (): void => {
    context.getWindow()?.webContents.send(IPC.libraryChanged)
  }

  ipcMain.handle(IPC.libraryGet, () => library(context.repo, context.metadata))

  ipcMain.handle(IPC.librarySync, async () => {
    const result = await runSync(context.adapters, context.repo, Math.floor(Date.now() / 1000))
    notifyChanged()
    return result
  })

  ipcMain.handle(IPC.gameLaunch, async (_event, gameId: unknown) => {
    if (typeof gameId !== 'string') {
      return { ok: false, error: t().errors.invalidGameId }
    }
    // repo.byId touches SQLite and can throw — full disk, locked file,
    // corrupted database. Without this catch the error would reach the
    // renderer as a rejected promise, where it would vanish for lack of
    // handling: the button would simply do nothing.
    try {
      const game = context.repo.byId(gameId)
      if (game === undefined) {
        return { ok: false, error: t().errors.unknownGame(gameId) }
      }
      return await launchGame(context.adapters, game)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: t().errors.launchFailed(message) }
    }
  })

  ipcMain.handle(IPC.gameInstall, async (_event, gameId: unknown) => {
    if (typeof gameId !== 'string') {
      return { ok: false, error: t().errors.invalidGameId }
    }
    // Same safeguard as for launching, for the same reason.
    try {
      const game = context.repo.byId(gameId)
      if (game === undefined) {
        return { ok: false, error: t().errors.unknownGame(gameId) }
      }
      return await installGame(context.adapters, game, {
        frame: () => installFrame(context.getWindow())
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: t().errors.installFailed(message) }
    }
  })

  /**
   * Ends the wait for the store's dialog.
   *
   * Takes no argument and returns nothing: there is at most one install
   * being waited on, and the caller is the overlay that was showing it.
   */
  ipcMain.handle(IPC.gameInstallCancel, () => {
    cancelInstall()
  })

  ipcMain.handle(IPC.gameSetFavorite, (_event, mergeKey: unknown, value: unknown) => {
    if (typeof mergeKey !== 'string' || typeof value !== 'boolean') return
    try {
      // Set it on every source: a merged entry counts as a favourite as
      // soon as one source is. Toggling only the active one would make it
      // impossible to clear while another source still had it set.
      const entry = library(context.repo, context.metadata).find((e) => e.key === mergeKey)
      if (entry === undefined) return
      for (const source of entry.sources) {
        context.repo.setFavorite(source.id, value)
      }
      notifyChanged()
    } catch (error) {
      console.error('Favourite could not be set:', error)
    }
  })

  ipcMain.handle(IPC.mergeSetPreferred, (_event, mergeKey: unknown, gameId: unknown) => {
    if (typeof mergeKey !== 'string') return
    if (gameId !== undefined && typeof gameId !== 'string') return
    try {
      context.repo.setPreferredStore(mergeKey, gameId)
      notifyChanged()
    } catch (error) {
      console.error('Store choice could not be saved:', error)
    }
  })

  /**
   * Opens the install folder.
   *
   * Deliberately takes the merge key and looks the path up itself. A path
   * handed over by the renderer would be a hole: an injected string could
   * have any folder on the system opened.
   */
  ipcMain.handle(IPC.gameOpenFolder, async (_event, mergeKey: unknown) => {
    if (typeof mergeKey !== 'string') return { ok: false, error: t().errors.invalidKey }
    try {
      const entry = library(context.repo, context.metadata).find((e) => e.key === mergeKey)
      const path = entry?.installPath
      if (path === undefined || path === '') {
        return { ok: false, error: t().errors.noFolderKnown }
      }

      // Check first: showItemInFolder does nothing at all, silently, for a
      // path that no longer exists. The button would look broken when in
      // truth the game was uninstalled outside the app.
      try {
        await stat(path)
      } catch {
        return { ok: false, error: t().errors.folderGone(path) }
      }

      shell.showItemInFolder(path)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: t().errors.folderOpenFailed(message) }
    }
  })

  ipcMain.handle(IPC.metadataSearch, (_event, query: unknown) => {
    if (typeof query !== 'string') return []
    return context.appList.search(query).map((app) => ({ appId: app.appid, name: app.name }))
  })

  ipcMain.handle(IPC.metadataSetMatch, async (_event, mergeKey: unknown, appId: unknown) => {
    if (typeof mergeKey !== 'string' || typeof appId !== 'number' || !Number.isInteger(appId)) {
      return { ok: false, error: t().errors.invalidInput }
    }
    try {
      const entry = library(context.repo, context.metadata).find((e) => e.key === mergeKey)
      if (entry === undefined) return { ok: false, error: t().errors.unknownGameShort }

      // Applied to the active source: that is where the library reads
      // metadata from first, so a correction on any other source would stay
      // invisible.
      const ok = await applyManualMatch(context.metadata, entry.active.id, appId, {
        fetchDetails: context.fetchDetails,
        now: () => Math.floor(Date.now() / 1000)
      })
      notifyChanged()
      return ok ? { ok: true } : { ok: false, error: t().errors.matchSavedFetchFailed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: t().errors.matchFailed(message) }
    }
  })

  ipcMain.handle(IPC.mergeSetSplit, (_event, mergeKey: unknown, split: unknown) => {
    if (typeof mergeKey !== 'string' || typeof split !== 'boolean') return
    try {
      context.repo.setSplit(mergeKey, split)
      notifyChanged()
    } catch (error) {
      console.error('Split could not be saved:', error)
    }
  })

  /**
   * Adds a game by hand.
   *
   * Every field is validated in the repository rather than here, because
   * that is the layer the constraint belongs to — a store identifier must
   * not reach a launch URI unchecked, no matter which caller supplied it.
   * This handler only converts a thrown error into a message the interface
   * can show.
   */
  ipcMain.handle(IPC.libraryAddManual, (_event, game: unknown) => {
    if (typeof game !== 'object' || game === null) {
      return { ok: false, error: t().errors.invalidInput }
    }
    const { storeId, name, storeGameId } = game as Record<string, unknown>
    if (typeof storeId !== 'string' || typeof name !== 'string') {
      return { ok: false, error: t().errors.invalidInput }
    }
    if (!STORE_IDS.includes(storeId as StoreId)) {
      return { ok: false, error: t().errors.invalidInput }
    }
    if (storeGameId !== undefined && typeof storeGameId !== 'string') {
      return { ok: false, error: t().errors.invalidInput }
    }

    try {
      const id = context.repo.addManualGame(
        { storeId: storeId as StoreId, name, ...(storeGameId === undefined ? {} : { storeGameId }) },
        Math.floor(Date.now() / 1000)
      )
      notifyChanged()
      return { ok: true, id }
    } catch (error) {
      // The message carries the reason the user needs — a duplicate, an
      // empty name, an identifier of the wrong shape — so it is passed on
      // rather than replaced with something generic.
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.libraryRemoveManual, (_event, gameId: unknown) => {
    if (typeof gameId !== 'string') return { ok: false, error: t().errors.invalidGameId }
    try {
      context.repo.removeManualGame(gameId)
      notifyChanged()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * Forgets artwork the renderer could not load.
   *
   * Steam's URLs are derived from the AppID and were once stored without
   * being checked, so a game with no library capsule ended up with a row
   * pointing at a 404. That row then counted as artwork and kept the game
   * out of the SteamGridDB fallback for good. New writes are verified now;
   * this repairs what is already stored, using the browser's own failed
   * request rather than a separate sweep.
   *
   * Deliberately no `notifyChanged`: the renderer has already hidden the
   * broken image locally, and a library of 260 entries reloading once per
   * broken picture would be a burst of work for no visible gain. What
   * matters is that the next artwork pass sees the gap.
   */
  ipcMain.handle(IPC.artworkBroken, (_event, mergeKey: unknown, kind: unknown) => {
    if (typeof mergeKey !== 'string') return
    if (kind !== 'grid' && kind !== 'hero' && kind !== 'logo') return
    try {
      const entry = library(context.repo, context.metadata).find((e) => e.key === mergeKey)
      if (entry === undefined) return
      // The artwork hangs off one of the sources, and which one is not
      // knowable from the renderer — `library()` takes the first source
      // that has any. Removing the kind from every source of the entry is
      // both simpler and correct: they are the same game.
      for (const source of entry.sources) {
        context.metadata.removeArtwork(source.id, kind)
      }
      // Only now, and only for a gap that really opened: the pass costs a
      // walk over the whole library and a request per game.
      context.onArtworkGap?.()
    } catch (error) {
      console.error('Broken artwork could not be discarded:', error)
    }
  })

  /**
   * Records the interface language.
   *
   * Validated rather than trusted: the value crosses a process boundary, and
   * an unrecognised one would leave `BUNDLES[value]` undefined and blank the
   * whole interface.
   *
   * `notifyChanged` at the end is not decoration. The library carries the
   * metadata for one language; after a switch the renderer has to fetch it
   * again, or descriptions would stay in the previous language until the
   * next scan.
   */
  ipcMain.handle(IPC.settingsSetLanguage, (_event, language: unknown) => {
    const parsed = parseLanguage(language)
    if (parsed === undefined) return
    try {
      setLanguage(parsed)
      context.settings.set('language', parsed)
      notifyChanged()
    } catch (error) {
      console.error('Language could not be saved:', error)
    }
  })

  ipcMain.handle(IPC.envConfigGet, () => readEnvConfig(context.envFilePaths))

  /**
   * Writes the API keys and the marker that says the question was answered.
   *
   * `undefined` is the skip: answered, but nothing written over the keys the
   * file already holds.
   *
   * Every value is validated before anything is written. A line break in one
   * of them would end its assignment and turn the rest into a variable of
   * its own — arbitrary settings injected through a text field — and the
   * file must not be half-written when that is rejected.
   */
  ipcMain.handle(IPC.envConfigSave, (_event, values: unknown) => {
    const checked = validEnvValues(values)
    if (checked === 'invalid') {
      return { ok: false, error: t().errors.invalidInput, restarting: false }
    }

    try {
      const { changed } = saveEnvConfig(context.envFilePaths, checked)
      // Only for a real change: a skip, or a save of what was already there,
      // gives the new process nothing it does not already have.
      if (changed) context.relaunch()
      return { ok: true, restarting: changed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: t().errors.envSaveFailed(message), restarting: false }
    }
  })
}

/**
 * The values as they may be written, `undefined` for a skip, or `'invalid'`.
 *
 * Three outcomes rather than a boolean, because "no values" is a legitimate
 * request here and must not be confused with "values that were rejected".
 */
function validEnvValues(values: unknown): EnvConfigValues | undefined | 'invalid' {
  if (values === undefined || values === null) return undefined
  if (typeof values !== 'object') return 'invalid'

  const record = values as Record<string, unknown>
  const checked = {} as EnvConfigValues

  for (const key of ENV_CONFIG_KEYS) {
    const value = record[key]
    if (typeof value !== 'string' || !envValueIsWritable(value)) return 'invalid'
    checked[key] = value
  }

  return checked
}
