import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { config as loadDotenv } from 'dotenv'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { SettingsRepository } from '@main/db/settings'
import { createAdapters } from '@main/stores'
import { registerIpcHandlers } from '@main/ipc'
import { runSync } from '@main/sync'
import { closeArtworkGaps, runMetadataService } from '@main/metadata/service'
import { createGapScheduler } from '@main/metadata/gapScheduler'
import { SteamAppList } from '@main/metadata/steamAppList'
import { fetchAppDetails } from '@main/metadata/steamStore'
import { SECURE_WEB_PREFERENCES } from '@main/window-options'
import { IPC } from '@shared/ipc'
import { getLanguage, parseLanguage, setLanguage, t } from '@shared/i18n'
import { envFileCandidates } from '@main/env-file'
import { createScanState } from '@main/scan-state'
import { enabledAdapters } from '@main/stores/enabled'
import { MicrosoftSession, type TokenStore } from '@main/stores/microsoft/session'
import { pollForTokens, requestDeviceCode } from '@main/stores/microsoft/auth'
import { FreebieRepository } from '@main/db/freebies'
import { FreebieService } from '@main/freebies/service'
import { confirmClaims } from '@main/freebies/confirm'
import { resolveStoreCountry } from '@main/locale-country'

let mainWindow: BrowserWindow | undefined

/**
 * How long to collect discarded images before running a pass for them.
 *
 * The renderer reports a broken tile as it paints it, so a screenful arrives
 * within a few hundred milliseconds. Two seconds catches the burst and is
 * still quick enough that the pictures appear while the same screen is being
 * looked at.
 */
const ARTWORK_GAP_DELAY_MS = 2_000

/**
 * Loads the API keys.
 *
 * Deliberately not at module scope: `app.getPath('userData')` is only
 * meaningful once Electron is ready, and an installed copy has no checkout
 * to find a `.env` in.
 */
function loadApiKeys(paths: string[]): void {
  for (const path of paths) {
    // `override: false` so the first file found wins, matching the order in
    // envFileCandidates: a checkout's .env beats the installed one.
    loadDotenv({ path, override: false, quiet: true })
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#14161b',
    // Shown at once, not on `ready-to-show`.
    //
    // Waiting for that event is the usual advice, and it is meant to avoid a
    // white flash: the window would otherwise appear before the page had
    // painted anything. `backgroundColor` above already removes the flash —
    // the frame is drawn in Arcadia's own colour — and index.html paints a
    // named placeholder before the bundle runs, so there is nothing left for
    // the wait to protect against.
    //
    // What the wait cost was the whole reason to open the app at all.
    // `ready-to-show` fires only after the renderer process has started, the
    // 636 kB bundle has been fetched and compiled and React has painted a
    // frame. Measured here at 659 ms on a first start against 343 ms on a
    // later one — the difference is V8 compiling the bundle with no code
    // cache yet — and on a cold machine it is far longer. For all of it there
    // was no window and no taskbar button: clicking the icon appeared to do
    // nothing, which is exactly the complaint.
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...SECURE_WEB_PREFERENCES
    }
  })

  /**
   * The mouse's back button.
   *
   * Windows routes the thumb buttons to the window as an app-command, not
   * into the page, so the renderer never sees them as DOM events. The event
   * is Windows-only; on Linux the renderer's own `mouseup` handler does the
   * job, and there both are needed to cover the two platforms.
   */
  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward') win.webContents.send(IPC.navigateBack)
    if (command === 'browser-forward') win.webContents.send(IPC.navigateForward)
  })

  // Open external links in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Surface load failures instead of letting them vanish as an unhandled
  // rejection — without a message there would only be an empty window.
  const onLoadError = (error: unknown): void => {
    console.error('Renderer could not be loaded:', error)
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL).catch(onLoadError)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')).catch(onLoadError)
  }

  return win
}

const MICROSOFT_TOKEN_KEY = 'microsoft-refresh-token'
/** Marks a value as encrypted, so a plaintext fallback stays readable. */
const ENCRYPTED_PREFIX = 'enc:'

/**
 * Where the Microsoft refresh token is kept.
 *
 * In the database rather than the `.env`: that file holds keys the user
 * typed, and Arcadia writing a rotating credential into it would be a
 * surprise. Encrypted through safeStorage, which is DPAPI on Windows.
 *
 * Where encryption is unavailable — some Linux desktops have no keyring —
 * the token is stored as it is. That is worth doing rather than refusing:
 * the file already sits in the user's own profile, and the alternative is
 * signing in again on every start. The configuration screen says so.
 */
function microsoftTokenStore(settings: SettingsRepository): TokenStore {
  return {
    read: () => {
      const stored = settings.get(MICROSOFT_TOKEN_KEY)
      if (stored === undefined || stored === '') return undefined
      if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored
      try {
        return safeStorage.decryptString(
          Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64')
        )
      } catch {
        // Encrypted by another machine or another user account. The token is
        // unusable, and reporting it as absent asks for a fresh sign-in.
        return undefined
      }
    },
    write: (value) => {
      if (value === undefined) {
        settings.set(MICROSOFT_TOKEN_KEY, '')
        return
      }
      if (!safeStorage.isEncryptionAvailable()) {
        settings.set(MICROSOFT_TOKEN_KEY, value)
        return
      }
      settings.set(
        MICROSOFT_TOKEN_KEY,
        ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
      )
    }
  }
}

app.whenReady().then(() => {
  // The window before the setup, not after it.
  //
  // None of what follows needs a window, and the renderer runs in a process
  // of its own: while this one opens the database and builds the adapters,
  // Chromium is already starting up and fetching the bundle. The two now
  // overlap instead of running one after the other, and the window is on
  // screen for the whole of it rather than appearing at the end.
  //
  // EVERYTHING FROM HERE TO registerIpcHandlers MUST STAY SYNCHRONOUS.
  // The renderer asks for the library and the configuration as soon as its
  // bundle runs, and `ipcMain.handle` has to be in place before the first
  // `invoke` arrives. As long as no `await` interrupts this run, the event
  // loop cannot deliver one in between and the order is guaranteed. Insert
  // an await above the registration and the first start breaks with "No
  // handler registered" — a failure that would only ever show up on a
  // machine slow enough to matter.
  mainWindow = createWindow()

  // The same list twice over: dotenv loads from it now, and the
  // configuration screen writes back to it later. Computed once so the two
  // can never disagree about which file is in force.
  const envFilePaths = envFileCandidates({
    cwd: process.cwd(),
    userData: app.getPath('userData')
  })

  // Before anything reads process.env — the adapters below do.
  loadApiKeys(envFilePaths)

  /**
   * Opening the database must not be able to stop the app from starting.
   *
   * This used to be a bare `openDatabase`, and a corrupt file made it throw
   * — partway through this function, so `registerIpcHandlers` below never
   * ran. Arcadia then came up with a window, a rendered library and every
   * IPC channel missing, reporting "No handler registered for
   * 'library:sync'": a message that names the wrong subsystem and gives no
   * hint that a file on disk is at fault.
   *
   * `openDatabase` now sets a damaged file aside by itself, so the common
   * case never reaches this catch. What is left for it is everything a
   * retry cannot mend — no permission, a full disk, a path that is a
   * directory. Those fall back to an in-memory database: the app is
   * useless-but-honest for that run rather than dead and inexplicable, and
   * `startupNotice` carries the reason to the banner.
   */
  let startupNotice: string | undefined
  let db: DatabaseSync
  try {
    db = openDatabase(join(app.getPath('userData'), 'arcadia.db'), ({ movedTo }) => {
      console.warn(`Database was damaged; kept the old file as ${movedTo}`)
      startupNotice = t().errors.databaseRecovered(movedTo)
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('Database could not be opened:', error)
    startupNotice = t().errors.databaseUnusable(detail)
    db = openDatabase(':memory:')
  }

  const repo = new GameRepository(db)
  const metadata = new MetadataRepository(db)
  const settings = new SettingsRepository(db)

  // Held in its own name rather than inlined: the confirmation hook below
  // needs the repository, not the service.
  const freebieRepo = new FreebieRepository(db)

  const freebies = new FreebieService({
    repo: freebieRepo,
    settings,
    // The store country prefers the OS's own ISO 3166 code — the real
    // region, not a guess parsed out of a language tag — and only falls
    // back to the locale when the OS has none to offer. See
    // resolveStoreCountry for the order and why. Falls back to US as a last
    // resort, which is the region Epic's feed defaults to.
    locale: () => ({
      language: getLanguage(),
      country: resolveStoreCountry(app.getLocaleCountryCode(), app.getLocale())
    }),
    // Read fresh per call, not captured once: a game bought after the
    // giveaway appeared must show as owned on the very next list request.
    games: () => repo.all()
  })

  const microsoftSession = new MicrosoftSession({
    store: microsoftTokenStore(settings),
    // A scan can sign itself out: a refresh token the service has refused
    // is discarded on the spot, with no IPC handler involved to announce
    // it. Without this the configuration screen would keep showing
    // "Signed in as …" until it was closed and reopened.
    onChanged: () => mainWindow?.webContents.send(IPC.microsoftAuthChanged)
  })

  // Still before the renderer can ask, which is what actually matters: the
  // window is created above, but the language reaches the interface through
  // `settings:get-language`, and that handler is registered further down in
  // this same synchronous run. It also has to happen before the first
  // metadata pass, which asks Steam for whichever language is set right now.
  const stored = parseLanguage(settings.get('language'))
  if (stored !== undefined) setLanguage(stored)

  // Keys come from the environment for now; .env is covered by .gitignore.
  //
  // STEAM_ID64 is optional: without it the adapter derives the ID from
  // loginusers.vdf.
  //
  // The app list is created once and used by three parties: the background
  // service fills it, the manual-match search box reads from it, and the
  // Steam adapter resolves the names of shared games with it.
  const appList = new SteamAppList()

  const adapters = createAdapters({
    steam: {
      apiKey: process.env.STEAM_WEB_API_KEY,
      steamId64: process.env.STEAM_ID64
    },
    // EA's entitlement store names nothing; the catalogue service does, and
    // its answers are cached here so a rescan costs no request.
    ea: { catalogCachePath: join(app.getPath('userData'), 'ea-catalog.json') },
    // Names for the games from localconfig.vdf. The local file knows only
    // identifiers; without a name a game is skipped.
    resolveSteamName: (appId) => appList.nameFor(appId),
    microsoft: { catalogCachePath: join(app.getPath('userData'), 'microsoft-catalog.json') },
    microsoftSession
  })

  // Closes gaps the app opens itself. The renderer reports images that fail
  // to load, the handler discards those rows, and without this the
  // replacement waited for the next start — the artwork pass runs once,
  // right after the first scan.
  const artworkGaps = createGapScheduler({
    delayMs: ARTWORK_GAP_DELAY_MS,
    run: () =>
      closeArtworkGaps(repo, metadata, {
        userDataDir: app.getPath('userData'),
        steamGridDbKey: process.env.STEAMGRIDDB_API_KEY,
        onProgress: () => mainWindow?.webContents.send(IPC.libraryChanged)
      })
  })

  // Tells the window whenever a scan starts or stops, from either source.
  // `send` on a window that has since been closed is a no-op, so the
  // optional chaining is the whole guard needed.
  const scan = createScanState((scanning) => {
    mainWindow?.webContents.send(IPC.libraryScanning, scanning)
  })

  registerIpcHandlers({
    repo,
    metadata,
    settings,
    adapters,
    freebies,
    freebiesRepo: freebieRepo,
    scan,
    appList,
    // Built above in whatever language the module currently holds, which is
    // English: the stored language lives in the very database that failed,
    // so there is nothing else it could truthfully be.
    ...(startupNotice === undefined ? {} : { startupNotice }),
    fetchDetails: fetchAppDetails,
    getWindow: () => mainWindow,
    onArtworkGap: () => artworkGaps.request(),
    // Asked at the moment the screen asks, not captured here: a keyring can
    // be unlocked while Arcadia runs, and a cached "no" would go on warning
    // about a file that is encrypted by then.
    secureStorageAvailable: () => safeStorage.isEncryptionAvailable(),
    microsoft: {
      session: microsoftSession,
      requestDeviceCode: () => requestDeviceCode(),
      // `cancelled` was declared and checked in pollForTokens but never
      // supplied, so a started poll ran to the server's expiry with nothing
      // able to stop it. The handler owns the flow and decides.
      pollForTokens: (code, cancelled) => pollForTokens(code, { cancelled })
    },
    envFilePaths,
    // The keys reach the adapters at startup and nowhere else, so a changed
    // key only takes effect in a process that starts after it was written.
    relaunch: () => {
      app.relaunch()
      app.exit(0)
    }
  })

  // A year. The table is tiny; this exists so it cannot grow without bound
  // over the life of an installation.
  freebieRepo.pruneClaims(Date.now() - 365 * 86_400_000)

  // First scan in the background: the UI shows the cache immediately and
  // refreshes once the scan is through.
  //
  // The app list cache is loaded before that, not by the metadata service
  // afterwards: the Steam adapter needs it during the scan to resolve the
  // names of shared games. It is a local file; on the very first start it
  // does not exist yet, and those games then arrive with the next scan.
  //
  // Tracked through `scan` so the renderer can say so. On a first start this
  // is the only scan there is and the library is empty until it returns —
  // untracked, the window reported "No games found yet" for the whole of it
  // and invited a Refresh that was already running.
  void scan
    .track(async () => {
      await appList.loadCache(join(app.getPath('userData'), 'steam-apps.json'))
      return runSync(
        enabledAdapters(adapters, settings.get('enabled-stores')),
        repo,
        Math.floor(Date.now() / 1000),
        (games) => {
          if (confirmClaims(freebieRepo, games, Date.now()).length > 0) {
            mainWindow?.webContents.send(IPC.freebiesChanged)
          }
        }
      )
    })
    .then((result) => {
      console.log(`Scan finished: ${result.totalGames} games`)
      for (const store of result.stores) {
        if (!store.ok) console.warn(`[${store.storeId}] ${store.error}`)
      }
      mainWindow?.webContents.send(IPC.libraryChanged)

      // Only after the scan: before it, the service would not know which
      // games to fetch anything for.
      return runMetadataService(repo, metadata, {
        userDataDir: app.getPath('userData'),
        steamApiKey: process.env.STEAM_WEB_API_KEY,
        appList,
        steamGridDbKey: process.env.STEAMGRIDDB_API_KEY,
        onProgress: () => mainWindow?.webContents.send(IPC.libraryChanged)
      })
    })
    .catch((error: unknown) => console.error('Scan failed:', error))

  // Kicked off after the window exists, so the event this can send has
  // somewhere to go.
  //
  // Forced, unlike every other caller of refresh — the freebies:get handler,
  // the renderer's reload-on-event — which all still go through the TTL
  // guard. This call happens once per process launch, not once per event,
  // so it cannot become the request storm attempted-at was introduced to
  // stop; it just means a restart inside the six-hour window still shows a
  // fresh list instead of silently serving the cache.
  void freebies
    .refresh(Date.now(), true)
    .then((changed) => {
      if (changed) mainWindow?.webContents.send(IPC.freebiesChanged)
    })
    .catch((error: unknown) => console.error('The freebies could not be fetched:', error))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
