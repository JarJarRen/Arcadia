import type { LibraryEntry } from './library'
import type { SyncResult } from './sync-types'

export const IPC = {
  libraryGet: 'library:get',
  librarySync: 'library:sync',
  libraryChanged: 'library:changed',
  gameLaunch: 'game:launch',
  gameSetFavorite: 'game:set-favorite',
  gameOpenFolder: 'game:open-folder',
  gameInstall: 'game:install',
  mergeSetPreferred: 'merge:set-preferred',
  mergeSetSplit: 'merge:set-split',
  metadataSearch: 'metadata:search',
  metadataSetMatch: 'metadata:set-match',
  settingsSetLanguage: 'settings:set-language',
  libraryAddManual: 'library:add-manual',
  libraryRemoveManual: 'library:remove-manual',
  artworkBroken: 'artwork:broken',
  navigateBack: 'navigate:back',
  navigateForward: 'navigate:forward'
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

export interface ArcadiaApi {
  getGames(): Promise<LibraryEntry[]>
  sync(): Promise<SyncResult>
  /** Expects the `id` of the active store entry. */
  launch(gameId: string): Promise<LaunchResult>
  /** Opens the store's install dialog; expects the same `id`. */
  install(gameId: string): Promise<LaunchResult>
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
  }): Promise<{ ok: boolean; error?: string; id?: string }>
  /** Deletes a hand-made entry. Refuses anything a scan found. */
  removeManualGame(gameId: string): Promise<LaunchResult>
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
}

export interface AppSuggestion {
  appId: number
  name: string
}
