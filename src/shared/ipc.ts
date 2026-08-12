import type { LibraryEntry } from './library'
import type { SyncResult } from './sync-types'
import type { EnvConfigSaveResult, EnvConfigState, EnvConfigValues } from './env-config'
import type { AvailabilityResult, StoreId } from './types'
import type { FreebieList } from './freebies'

export const IPC = {
  libraryGet: 'library:get',
  librarySync: 'library:sync',
  libraryChanged: 'library:changed',
  /**
   * Whether a scan is running right now, asked once when the renderer mounts.
   *
   * A pull as well as the event below, because the startup scan begins while
   * the renderer is still compiling its bundle: by the time it subscribes,
   * `libraryScanning` has already been sent and missed. Asking on mount is
   * what closes that window.
   */
  libraryScanState: 'library:scan-state',
  /**
   * Anything that went wrong before the window could show it.
   *
   * Startup runs before the renderer exists, so a failure there has nowhere
   * to go but the console. This is how it reaches the banner instead.
   */
  startupNotice: 'app:startup-notice',
  /** Sent with `true` when a scan starts and `false` when it ends. */
  libraryScanning: 'library:scanning',
  gameLaunch: 'game:launch',
  gameSetFavorite: 'game:set-favorite',
  gameOpenFolder: 'game:open-folder',
  gameInstall: 'game:install',
  gameInstallCancel: 'game:install-cancel',
  mergeSetPreferred: 'merge:set-preferred',
  mergeSetSplit: 'merge:set-split',
  metadataSearch: 'metadata:search',
  metadataSetMatch: 'metadata:set-match',
  settingsGetLanguage: 'settings:get-language',
  settingsSetLanguage: 'settings:set-language',
  settingsGetStores: 'settings:get-stores',
  settingsSetStores: 'settings:set-stores',
  storesAvailability: 'stores:availability',
  /**
   * Whether the operating system can encrypt what Arcadia stores.
   *
   * Its own channel rather than a field on `stores:availability`: that probe
   * answers per store and only for a store that exists here, and the case
   * this reports — a Linux desktop with no keyring — is precisely one where
   * the Microsoft adapter calls itself unavailable while the sign-in and its
   * refresh token are still perfectly reachable.
   */
  storesSecureStorage: 'stores:secure-storage',
  envConfigGet: 'env-config:get',
  envConfigSave: 'env-config:save',
  libraryAddManual: 'library:add-manual',
  libraryRemoveManual: 'library:remove-manual',
  /**
   * Opens a file dialog for the program a storeless game starts.
   *
   * The dialog belongs in main: the renderer must not be the thing that
   * names a path, the same reasoning as `gameOpenFolder`.
   */
  libraryPickExecutable: 'library:pick-executable',
  artworkBroken: 'artwork:broken',
  navigateBack: 'navigate:back',
  navigateForward: 'navigate:forward',
  microsoftAuthState: 'microsoft:auth-state',
  microsoftSignIn: 'microsoft:sign-in',
  microsoftSignOut: 'microsoft:sign-out',
  microsoftAuthChanged: 'microsoft:auth-changed',
  freebiesGet: 'freebies:get',
  freebiesRefresh: 'freebies:refresh',
  /**
   * Opens the store's claim page for one offer.
   *
   * Takes the row id, **not a URL**. The address is looked up in the
   * database by the main process and validated there — the same reasoning
   * as `gameOpenFolder`, and it matters more here: one of the three sources
   * is a third party whose response Arcadia does not control.
   */
  freebiesClaim: 'freebies:claim',
  /** Fires on a background refresh and when a scan confirms a claim. */
  freebiesChanged: 'freebies:changed'
} as const

export interface LaunchResult {
  ok: boolean
  error?: string
  /**
   * Explanation for an action that succeeded but did not finish the job.
   *
   * So far only for installing via EA: its launcher has no deep link for
   * installing, only one for opening the library. Without the hint the
   * click would look as though it had done nothing.
   */
  notice?: string
}

export interface PickedExecutable {
  ok: boolean
  /** The program, with a Windows shortcut already resolved to its target. */
  exe?: string
  /** The shortcut's own arguments, already split. Empty otherwise. */
  args?: string[]
  /** A first guess at the game's name, for prefilling the field. */
  suggestedName?: string
  /** Absent when the user simply closed the dialog. */
  error?: string
}

export interface MicrosoftAuthState {
  signedIn: boolean
  gamertag?: string
}

export interface MicrosoftSignInStart {
  ok: boolean
  /** The short code to type in the browser. */
  userCode?: string
  verificationUri?: string
  error?: string
}

export interface ArcadiaApi {
  getGames(): Promise<LibraryEntry[]>
  sync(): Promise<SyncResult>
  /** Expects the `id` of the active store entry. */
  launch(gameId: string): Promise<LaunchResult>
  /** Opens the store's install dialog; expects the same `id`. */
  install(gameId: string): Promise<LaunchResult>
  /**
   * Stops waiting for the store's install dialog.
   *
   * Cancels the **assistance**, not the installation: the store already
   * has the URI and carries on. Only the overlay and the window agent end.
   */
  cancelInstall(): Promise<void>
  /**
   * Expects the merge key, not a game ID.
   *
   * A merged entry counts as a favourite as soon as one of its sources is.
   * If only the active source were toggled, the favourite could no longer
   * be cleared while another source still had it set.
   */
  setFavorite(mergeKey: string, value: boolean): Promise<void>
  /** `gameId` is the `id` of the desired store, or undefined to reset. */
  setPreferredStore(mergeKey: string, gameId: string | undefined): Promise<void>
  setSplit(mergeKey: string, split: boolean): Promise<void>
  /**
   * Opens the install folder in the file manager.
   *
   * Takes the merge key, **not a path**. The path is looked up in the
   * database by the main process. Otherwise the renderer could have any
   * folder opened — the same class of bug that was caught once before in
   * review, around `shell.openExternal`.
   */
  openFolder(mergeKey: string): Promise<LaunchResult>
  /** Suggestions from Steam's app list, for matching by hand. */
  searchApps(query: string): Promise<AppSuggestion[]>
  /** Matches a game to a Steam AppID by hand and fetches it immediately. */
  setMatch(mergeKey: string, steamAppId: number): Promise<LaunchResult>
  /**
   * The persisted interface language, so the renderer can start in it.
   *
   * Main applies the stored setting to its own copy of the i18n module at
   * startup; the renderer's copy is a separate module in a separate
   * process and always begins at `DEFAULT_LANGUAGE` regardless. Without
   * this call, a German setting would only ever show up in main's own
   * messages, never in the rendered UI.
   */
  getLanguage(): Promise<string>
  /**
   * Records the chosen interface language.
   *
   * The renderer switches its own strings through React state; this tells
   * the **main** process, which is a separate process with its own copy of
   * the i18n module. Without it, `steamStore.ts` would keep asking Steam for
   * the old language and the metadata queue would refill the wrong rows.
   * The value is persisted, so the next start opens in this language.
   */
  setLanguage(language: string): Promise<void>
  /**
   * The stores Arcadia scans and shows.
   *
   * Answered as the canonical list when nothing has been chosen, so a
   * renderer that has never seen the setting still gets a usable answer
   * rather than an empty one it would have to interpret.
   */
  getEnabledStores(): Promise<StoreId[]>
  /**
   * Records the store choice. Takes effect at once — unlike the API keys
   * there is nothing cached at startup to invalidate, so no restart.
   */
  setEnabledStores(stores: StoreId[]): Promise<void>
  /**
   * Whether each store was found on this machine.
   *
   * Every adapter, not only the enabled ones: the point is to tell someone
   * whether switching a store on would find anything.
   */
  getStoreAvailability(): Promise<Record<string, AvailabilityResult>>
  /**
   * Whether `safeStorage` can encrypt on this machine.
   *
   * False on a desktop with no keyring, where the Microsoft refresh token
   * is written to `arcadia.db` as it is. Storing it anyway is the right
   * trade — the file sits in the user's own profile, and the alternative is
   * signing in again on every start — but it must be said rather than
   * assumed, which is what the configuration screen uses this for.
   */
  isSecureStorageAvailable(): Promise<boolean>
  /**
   * The API keys as the `.env` currently holds them, plus whether the
   * configuration question has been answered.
   *
   * Read from the file rather than from `process.env`: an inherited
   * `STEAM_ID64` from the machine's own environment is not Arcadia's to
   * write into anybody's file, and prefilling a field with it would invite
   * exactly that.
   */
  getEnvConfig(): Promise<EnvConfigState>
  /**
   * Writes the keys and the "answered" marker, then restarts if anything
   * changed.
   *
   * Called without values to skip: the question counts as answered and the
   * file keeps whatever it already held.
   */
  saveEnvConfig(values?: EnvConfigValues): Promise<EnvConfigSaveResult>
  /**
   * Adds a game no adapter can see.
   *
   * `storeGameId` is optional. Without it the entry is a catalogue entry:
   * artwork and description still arrive through the usual Steam matching,
   * but nothing can be launched, because no store knows the generated
   * identifier.
   */
  addManualGame(game: {
    storeId: string
    name: string
    storeGameId?: string
    /** Only for the `other` store; rejected for every other. */
    launchExe?: string
    launchArgs?: string[]
  }): Promise<{ ok: boolean; error?: string; id?: string }>
  /** Deletes a hand-made entry. Refuses anything a scan found. */
  removeManualGame(gameId: string): Promise<LaunchResult>
  /**
   * Asks for the program a storeless game starts.
   *
   * Answers `{ ok: false }` with no error when the dialog was closed.
   */
  pickExecutable(): Promise<PickedExecutable>
  /**
   * Reports artwork that failed to load.
   *
   * Steam's image URLs are derived from the AppID rather than reported by
   * any API, so they can point at nothing — 13 of 217 games here. The row
   * is dropped, which makes the game eligible for the SteamGridDB fallback
   * on the next pass. Takes the merge key, like every other channel that
   * names a library entry.
   */
  reportBrokenArtwork(mergeKey: string, kind: string): Promise<void>
  /**
   * Whether a scan is in flight at this moment.
   *
   * Needed because the scan that runs at startup is begun by the main
   * process, not by the button: without asking, the renderer has no way to
   * know one is under way and reports an empty library as "nothing found"
   * while it is still being filled.
   */
  isScanning(): Promise<boolean>
  /**
   * What startup could not tell anyone at the time, or undefined.
   *
   * So far only the database: a damaged file is set aside and replaced,
   * which empties the library, and an unexplained empty library is its own
   * kind of bug.
   */
  getStartupNotice(): Promise<string | undefined>
  /** Fires whenever a scan starts or ends, from whichever source. */
  onScanningChanged(callback: (scanning: boolean) => void): () => void
  onLibraryChanged(callback: () => void): () => void
  /**
   * The mouse's back button, as reported by Windows.
   *
   * Windows delivers the thumb buttons as an `app-command` to the window
   * rather than as a DOM event, so the renderer cannot see them on its own.
   * The renderer also listens for `mouseup` with button 3, which is what
   * works on Linux; on Windows both may fire, and that is harmless because
   * going back twice from the same page is a no-op.
   */
  onNavigateBack(callback: () => void): () => void
  /** The forward thumb button; reopens the page back has just closed. */
  onNavigateForward(callback: () => void): () => void
  getMicrosoftAuth(): Promise<MicrosoftAuthState>
  /**
   * Starts the device-code sign-in.
   *
   * Answers as soon as the code exists, not when the sign-in completes: the
   * user still has to type the code into a browser, and the screen has to
   * be able to show it to them. Completion arrives as onMicrosoftAuthChanged.
   */
  signInToMicrosoft(): Promise<MicrosoftSignInStart>
  signOutOfMicrosoft(): Promise<void>
  /**
   * Fires on sign-in, sign-out, and a poll that ended without one.
   *
   * `error` carries the already-localised reason a poll failed — expired
   * code, declined, cancelled, or the raw failure message — so the screen
   * can show it instead of leaving a dead code on screen. Absent for the
   * success and sign-out cases, which have nothing to report.
   */
  onMicrosoftAuthChanged(callback: (error?: string) => void): () => void
  /** The cached list, filtered to the enabled stores. */
  getFreebies(): Promise<FreebieList>
  /** Forces a fetch and answers with the result. */
  refreshFreebies(): Promise<FreebieList>
  /**
   * Opens the claim page for one offer and records it as pending.
   *
   * Takes the row id. A renderer that could name the address could have
   * any address opened.
   */
  claimFreebie(id: string): Promise<LaunchResult>
  onFreebiesChanged(callback: () => void): () => void
}

export interface AppSuggestion {
  appId: number
  name: string
}
