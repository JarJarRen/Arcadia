import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
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
import { parseLanguage, setLanguage } from '@shared/i18n'
import { envFileCandidates } from '@main/env-file'
import { createScanState } from '@main/scan-state'
import { enabledAdapters } from '@main/stores/enabled'

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

  const db = openDatabase(join(app.getPath('userData'), 'arcadia.db'))
  const repo = new GameRepository(db)
  const metadata = new MetadataRepository(db)
  const settings = new SettingsRepository(db)

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
    resolveSteamName: (appId) => appList.nameFor(appId)
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
    scan,
    appList,
    fetchDetails: fetchAppDetails,
    getWindow: () => mainWindow,
    onArtworkGap: () => artworkGaps.request(),
    envFilePaths,
    // The keys reach the adapters at startup and nowhere else, so a changed
    // key only takes effect in a process that starts after it was written.
    relaunch: () => {
      app.relaunch()
      app.exit(0)
    }
  })

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
        Math.floor(Date.now() / 1000)
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
