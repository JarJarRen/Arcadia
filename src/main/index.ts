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
function loadApiKeys(): void {
  for (const path of envFileCandidates({ cwd: process.cwd(), userData: app.getPath('userData') })) {
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
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...SECURE_WEB_PREFERENCES
    }
  })

  win.once('ready-to-show', () => win.show())

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
  // Before anything reads process.env — the adapters below do.
  loadApiKeys()

  const db = openDatabase(join(app.getPath('userData'), 'arcadia.db'))
  const repo = new GameRepository(db)
  const metadata = new MetadataRepository(db)
  const settings = new SettingsRepository(db)

  // Before the window exists, so the interface opens in the chosen language
  // instead of rendering English first and swapping a frame later. It also
  // has to happen before the first metadata pass, which asks Steam for
  // whichever language is set right now.
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

  registerIpcHandlers({
    repo,
    metadata,
    settings,
    adapters,
    appList,
    fetchDetails: fetchAppDetails,
    getWindow: () => mainWindow,
    onArtworkGap: () => artworkGaps.request()
  })
  mainWindow = createWindow()

  // First scan in the background: the UI shows the cache immediately and
  // refreshes once the scan is through.
  //
  // The app list cache is loaded before that, not by the metadata service
  // afterwards: the Steam adapter needs it during the scan to resolve the
  // names of shared games. It is a local file; on the very first start it
  // does not exist yet, and those games then arrive with the next scan.
  void appList
    .loadCache(join(app.getPath('userData'), 'steam-apps.json'))
    .then(() => runSync(adapters, repo, Math.floor(Date.now() / 1000)))
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
