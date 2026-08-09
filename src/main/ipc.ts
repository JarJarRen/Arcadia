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
import type { ScanState } from '@main/scan-state'
import { cancelInstall, installGame, launchGame, type InstallFrame } from '@main/launch-bridge'
import { decodeWindowHandle } from '@main/platform/windows'
import type { SteamAppList } from '@main/metadata/steamAppList'
import { applyManualMatch } from '@main/metadata/queue'
import { readEnvConfig, saveEnvConfig } from '@main/env-config'
import { parseEnabledStores, serializeEnabledStores } from '@shared/stores'
import { enabledAdapters } from '@main/stores/enabled'
import { envValueIsWritable } from '@main/env-file'
import { ENV_CONFIG_KEYS, type EnvConfigValues } from '@shared/env-config'
import type { MicrosoftSession } from '@main/stores/microsoft/session'
import type { DeviceCode, MicrosoftTokens } from '@main/stores/microsoft/auth'

export interface IpcContext {
  repo: GameRepository
  metadata: MetadataRepository
  settings: SettingsRepository
  adapters: StoreAdapter[]
  getWindow: () => BrowserWindow | undefined
  /**
   * The shared record of whether a scan is running.
   *
   * Shared with the startup scan rather than owned here, so the toolbar
   * reports both the same way — the renderer cannot tell which process
   * started a scan, and should not have to.
   */
  scan: ScanState
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
  /**
   * Whether `safeStorage` can encrypt on this machine.
   *
   * Injected rather than read here, because `safeStorage` is Electron's and
   * these handlers are tested without it. Absent counts as available: the
   * only caller is a warning, and a warning shown on no evidence would be
   * worse than none.
   */
  secureStorageAvailable?: () => boolean
  /**
   * Something that went wrong before the window could report it.
   *
   * Startup happens before the renderer exists, so its failures have nowhere
   * to go. A damaged database is the case this was built for: it is replaced
   * rather than allowed to be fatal, which empties the library, and that
   * needs saying.
   */
  startupNotice?: string
  /**
   * The Microsoft account, where one can exist.
   *
   * Optional because everything else works without it — on Linux there is
   * no Microsoft Store at all — and the handlers answer "signed out" rather
   * than failing when it is absent.
   */
  microsoft?: {
    session: MicrosoftSession
    requestDeviceCode: () => Promise<DeviceCode>
    /**
     * `cancelled` is checked before every poll, and is what ends a flow
     * that has been superseded or signed out from under. Without it a
     * started poll ran to the server's expiry with nothing able to stop it.
     */
    pollForTokens: (code: DeviceCode, cancelled: () => boolean) => Promise<MicrosoftTokens>
  }
}

/**
 * A device-code sign-in that is still running.
 *
 * At most one exists. A second `microsoft:sign-in` — which is one dialog
 * close and reopen away, since closing it clears the code from the screen
 * but not the poll from this process — used to start a competing device
 * code and a second poll loop, each of which triggered a full five-store
 * rescan on success.
 */
interface SignInFlow {
  /** Read by the poll before each request. */
  cancelled: boolean
  /**
   * Whether a later sign-in took this one's place.
   *
   * A superseded flow reports nothing when it ends: the screen is already
   * showing the newer code, and "The sign-in was cancelled" arriving on top
   * of it would wipe the very code the user was about to type.
   */
  superseded: boolean
}

/**
 * Builds the library as the interface sees it.
 *
 * Artwork and metadata are attached here, not in `mergeLibrary` — that way
 * the merge stays free of database access and testable without a database.
 *
 * The rows are filtered by `enabled` BEFORE the merge, not after. That is
 * what makes a game owned on two stores behave: the switched-off source
 * drops away and the entry stays, under the store that is still on. Filtered
 * afterwards, the whole entry would vanish whenever its active source
 * happened to be the disabled one.
 *
 * The active store entry is consulted first, then the remaining sources:
 * for a merged game the image can hang off the Epic row while Steam is the
 * active store.
 */
function library(
  repo: GameRepository,
  metadata: MetadataRepository,
  enabled: StoreId[]
): LibraryEntry[] {
  const rows = repo.all().filter((game) => enabled.includes(game.storeId))
  return mergeLibrary(rows, repo.readMergeOverrides()).map((entry) => {
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
  // All three cases InstallAssist.frame promises. Minimised belongs here
  // because Windows reports degenerate bounds for it — centring on that
  // rectangle would put the dialog somewhere off-screen, which is worse
  // than not centring it at all.
  if (window === undefined || window.isDestroyed() || window.isMinimized()) {
    return undefined
  }

  const rect = screen.dipToScreenRect(window, window.getBounds())

  return {
    target: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    // Decoded by a tested function rather than inline: this whole helper
    // needs a live BrowserWindow and so cannot be reached from vitest, and
    // the handle read is the only part of it with anything to get wrong.
    owner: decodeWindowHandle(window.getNativeWindowHandle())
  }
}

/**
 * Toggles Arcadia holding itself above Steam's windows.
 *
 * Same destroyed-window guard as `installFrame`: the agent's `finally` can
 * still be clearing this after the window it targets is already gone, and a
 * destroyed `BrowserWindow` throws on any method call rather than reporting
 * itself unusable.
 */
function setInstallAlwaysOnTop(window: BrowserWindow | undefined, value: boolean): void {
  if (window === undefined || window.isDestroyed()) return
  window.setAlwaysOnTop(value)
}

export function registerIpcHandlers(context: IpcContext): void {
  const notifyChanged = (): void => {
    context.getWindow()?.webContents.send(IPC.libraryChanged)
  }

  /**
   * The library as the user has asked to see it.
   *
   * Read fresh each time rather than captured: the setting can change while
   * the app runs, and a captured list would keep a switched-off store on
   * screen until the next restart.
   */
  const visibleLibrary = (): LibraryEntry[] =>
    library(
      context.repo,
      context.metadata,
      parseEnabledStores(context.settings.get('enabled-stores'))
    )

  ipcMain.handle(IPC.libraryGet, () => visibleLibrary())

  ipcMain.handle(IPC.libraryScanState, () => context.scan.isScanning())

  ipcMain.handle(IPC.startupNotice, () => context.startupNotice)

  ipcMain.handle(IPC.librarySync, async () => {
    const adapters = enabledAdapters(context.adapters, context.settings.get('enabled-stores'))
    const result = await context.scan.track(() =>
      runSync(adapters, context.repo, Math.floor(Date.now() / 1000))
    )
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
        frame: () => installFrame(context.getWindow()),
        setAlwaysOnTop: (value) => setInstallAlwaysOnTop(context.getWindow(), value)
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
      const entry = visibleLibrary().find((e) => e.key === mergeKey)
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
      const entry = visibleLibrary().find((e) => e.key === mergeKey)
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
      const entry = visibleLibrary().find((e) => e.key === mergeKey)
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
      const entry = visibleLibrary().find((e) => e.key === mergeKey)
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
   * The interface language the renderer should start in.
   *
   * Answered from `@shared/i18n`'s own `getLanguage()` rather than a fresh
   * `context.settings.get('language')`: startup (`main/index.ts`) already
   * parses the stored value and applies it to this process's copy of the
   * module before any handler is registered, which makes that copy the
   * authoritative answer and spares a second read of the same row.
   */
  ipcMain.handle(IPC.settingsGetLanguage, () => getLanguage())

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

  ipcMain.handle(IPC.settingsGetStores, () =>
    parseEnabledStores(context.settings.get('enabled-stores'))
  )

  /**
   * Records which stores are scanned and shown.
   *
   * Rejected whole rather than filtered when an id is unknown: the renderer
   * offers only ids it got from `STORE_IDS`, so anything else is a bug worth
   * failing on rather than a value worth salvaging.
   *
   * `notifyChanged` because the visible library depends on this setting —
   * without it the grid would keep showing a store that has just been
   * switched off until the next scan.
   */
  ipcMain.handle(IPC.settingsSetStores, (_event, stores: unknown) => {
    if (!Array.isArray(stores)) return
    const valid = stores.every(
      (id) => typeof id === 'string' && STORE_IDS.includes(id as StoreId)
    )
    if (!valid) return

    try {
      context.settings.set('enabled-stores', serializeEnabledStores(stores as StoreId[]))
      notifyChanged()
    } catch (error) {
      console.error('Store selection could not be saved:', error)
    }
  })

  /**
   * Probes every store, for the configuration screen.
   *
   * Reuses what the adapters already implement for `runSync`, so the
   * renderer needs no per-store knowledge. A probe that throws answers
   * "unavailable" with its own message rather than rejecting the whole call
   * — one broken adapter must not blank the list.
   */
  ipcMain.handle(IPC.storesAvailability, async () => {
    const probes = await Promise.all(
      context.adapters.map(async (adapter) => {
        try {
          return [adapter.id, await adapter.isAvailable()] as const
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return [adapter.id, { available: false, reason }] as const
        }
      })
    )
    return Object.fromEntries(probes)
  })

  /**
   * Whether the Microsoft refresh token can be encrypted where it is kept.
   *
   * The configuration screen says so on the Microsoft row when it cannot —
   * the token then sits in `arcadia.db` in the clear, and the user is
   * entitled to know that before connecting an account.
   */
  ipcMain.handle(IPC.storesSecureStorage, () => context.secureStorageAvailable?.() ?? true)

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

  /**
   * Tells the renderer the sign-in state moved, and why when it moved
   * because a poll ended without one.
   *
   * `error` is already the localised sentence `auth.ts` threw — expired,
   * declined, cancelled, or the raw failure — passed straight through
   * rather than rewrapped, so main throws nothing away that the screen
   * could otherwise show.
   */
  const notifyAuthChanged = (error?: string): void => {
    context.getWindow()?.webContents.send(IPC.microsoftAuthChanged, error)
  }

  /**
   * The sign-in in progress, if there is one.
   *
   * Held in the closure rather than at module scope: `registerIpcHandlers`
   * is called exactly once in a real process, so the two are equivalent
   * there, and a closure cannot leak one test's half-finished flow into the
   * next.
   */
  let signInFlow: SignInFlow | undefined

  ipcMain.handle(IPC.microsoftAuthState, () => {
    const session = context.microsoft?.session
    if (session === undefined || !session.isSignedIn()) return { signedIn: false }
    const gamertag = session.gamertag()
    return { signedIn: true, ...(gamertag === undefined ? {} : { gamertag }) }
  })

  /**
   * Starts the sign-in and returns the code, not the result.
   *
   * The polling then runs on in this process. A handler that waited for it
   * would leave the configuration screen with nothing to show for as long as
   * the user took in their browser — which is exactly when they need to see
   * the code.
   *
   * A second attempt replaces the first rather than racing it. Closing the
   * dialog clears the code from the screen but not the poll from here, so
   * reopening it and clicking Sign in is an ordinary thing to do — and it
   * used to start a second device code and a second poll loop, each of
   * which triggered a full five-store rescan when it succeeded. Replacing
   * is the right way round rather than answering with the old code,
   * because it is also the only way a poll can be stopped at all: the user
   * clicking Sign in again is what says the first attempt is over.
   */
  ipcMain.handle(IPC.microsoftSignIn, async () => {
    const microsoft = context.microsoft
    if (microsoft === undefined) {
      return { ok: false, error: t().stores.microsoft.windowsOnly }
    }

    if (signInFlow !== undefined) {
      signInFlow.cancelled = true
      signInFlow.superseded = true
    }

    // Registered before the device-code request, not after: that request is
    // an await, and a second invocation that enters while this one is still
    // in flight must find a flow here to supersede. Registering it only
    // after the await left a window where two overlapping invocations each
    // saw signInFlow as undefined and neither cancelled the other — the
    // first would go on to report its own expiry as an error and clear
    // whatever code the second one had already put on screen.
    const flow: SignInFlow = { cancelled: false, superseded: false }
    signInFlow = flow

    let code: DeviceCode
    try {
      code = await microsoft.requestDeviceCode()
    } catch (error) {
      // Only clears the slot if nothing newer has already taken it — a
      // concurrent invocation may have superseded this flow while the
      // request was in flight.
      if (signInFlow === flow) signInFlow = undefined
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    void microsoft
      .pollForTokens(code, () => flow.cancelled)
      .then(async (tokens) => {
        // The poll can only notice a cancellation between requests, so it
        // can still come back with tokens for a flow that has since been
        // signed out or replaced. Connecting an account on the strength of
        // that would undo whatever cancelled it.
        if (flow.cancelled) return
        microsoft.session.signIn(tokens)
        notifyAuthChanged()
        // At once, not at the next refresh: the owned library only becomes
        // readable now, and waiting would look as though nothing happened.
        await context.scan.track(() =>
          runSync(
            enabledAdapters(context.adapters, context.settings.get('enabled-stores')),
            context.repo,
            Math.floor(Date.now() / 1000)
          )
        )
        notifyChanged()
        // signIn() writes the token but does not itself learn the gamertag —
        // that only arrives from Xbox Live, through session.tokens(), which
        // the scan just above is what actually calls. The first
        // notifyAuthChanged, right after signIn(), told the screen a sign-in
        // was in progress; this second one is what lets it pick up the name
        // once the scan has had the chance to fetch it.
        notifyAuthChanged()
      })
      .catch((error: unknown) => {
        console.error('Microsoft sign-in failed:', error)
        // A flow that was replaced says nothing: the screen is already
        // showing the newer code, and its own cancellation arriving as an
        // error would clear the code the user is halfway through typing.
        if (flow.superseded) return
        notifyAuthChanged(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (signInFlow === flow) signInFlow = undefined
      })

    return { ok: true, userCode: code.userCode, verificationUri: code.verificationUri }
  })

  /**
   * Signs out and rescans.
   *
   * The rescan is the point: without it the owned-but-not-installed games
   * would sit in the library as rows nothing can account for.
   *
   * A sign-in still polling is cancelled as well, and told so — it is not
   * superseded by anything, so its own reason reaches the screen. Left
   * running it would connect an account moments after the user disconnected
   * one, which reads as the button having done nothing.
   */
  ipcMain.handle(IPC.microsoftSignOut, async () => {
    if (signInFlow !== undefined) signInFlow.cancelled = true
    context.microsoft?.session.signOut()
    notifyAuthChanged()
    await context.scan.track(() =>
      runSync(
        enabledAdapters(context.adapters, context.settings.get('enabled-stores')),
        context.repo,
        Math.floor(Date.now() / 1000)
      )
    )
    notifyChanged()
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
