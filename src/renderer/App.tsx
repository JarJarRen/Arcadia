import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'
import type { EnvConfigState } from '@shared/env-config'
import { STORE_IDS, type StoreId } from '@shared/types'
import { useLibrary } from './hooks/useLibrary'
import { useOverlay } from './hooks/useOverlay'
import {
  filterGames,
  pruneStores,
  sortGames,
  type LibraryFilter,
  type SortDirection,
  type SortKey,
  type ViewMode
} from './filter'
import { Library } from './Library'
import { AddGameDialog } from './components/AddGameDialog'
import { SetupDialog } from './components/SetupDialog'
import { InstallOverlay, OVERLAY_DELAY_MS } from './components/InstallOverlay'
import { STORE_LABELS } from './components/storeLabels'
import { isMouseBackButton, isMouseForwardButton } from './navigation'
import { LibraryToolbar } from './components/LibraryToolbar'
import { GameDetail } from './pages/GameDetail'
import './styles.css'

const INITIAL_FILTER: LibraryFilter = {
  search: '',
  stores: [],
  onlyInstalled: false,
  onlyFavorites: false,
  shared: 'all'
}

export function App(): ReactElement {
  const {
    entries,
    loading,
    syncing,
    error,
    clearError,
    sync,
    toggleFavorite,
    setPreferredStore,
    setSplit
  } = useLibrary()
  const [filter, setFilter] = useState<LibraryFilter>(INITIAL_FILTER)
  const [sort, setSort] = useState<SortKey>('name')
  // Held apart from the key and kept when the key changes, so the order never
  // flips back on its own. 'asc' with the name key is the library as it has
  // always opened.
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [view, setView] = useState<ViewMode>('grid')
  const [launchError, setLaunchError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  // No router: for two views it would be ballast. What is remembered is the
  // merge key, not the entry itself — the entry is rebuilt on every refresh,
  // and a captured copy would keep showing the old state once the metadata
  // arrives.
  const { overlay, openDetail, openFreebies, close, back, forward } = useOverlay()
  const [addOpen, setAddOpen] = useState(false)
  /**
   * The `.env` as the main process reads it, or undefined until it answers.
   *
   * Kept rather than fetched when the dialog opens: the first start has to
   * decide whether to show it at all, and the values it would prefill come
   * from the same answer.
   */
  const [envConfig, setEnvConfig] = useState<EnvConfigState | undefined>()
  const [setupOpen, setSetupOpen] = useState(false)
  /** True only for the dialog the first start puts up, where there is no way past it but answering. */
  const [setupIsGate, setSetupIsGate] = useState(false)
  // The id of a just-added game, waiting for the library to catch up.
  const [pendingSelect, setPendingSelect] = useState<string | undefined>()
  const [installPending, setInstallPending] = useState<StoreId | undefined>()
  /**
   * Which install the overlay belongs to.
   *
   * A second install while the first is still waiting would otherwise let
   * the older answer close the newer overlay.
   */
  const installSequence = useRef(0)
  /**
   * The stores switched on in the configuration screen.
   *
   * Starts as all of them rather than empty: the answer arrives over IPC a
   * beat after mount, and an empty list would blank the store filter for
   * that beat.
   */
  const [enabledStores, setEnabledStores] = useState<StoreId[]>([...STORE_IDS])

  const visible = useMemo(
    () => sortGames(filterGames(entries, filter), sort, sortDirection),
    [entries, filter, sort, sortDirection]
  )

  /**
   * The configuration gate.
   *
   * Asked once on mount: the marker in the `.env` says whether this question
   * has ever been answered, and only its absence opens the dialog. A failure
   * is swallowed on purpose — being unable to read the file is no reason to
   * block someone from their library, and the gear still opens the screen.
   */
  useEffect(() => {
    let cancelled = false
    window.arcadia
      .getEnvConfig()
      .then((state) => {
        if (cancelled) return
        setEnvConfig(state)
        if (!state.done) {
          setSetupIsGate(true)
          setSetupOpen(true)
        }
      })
      .catch((error: unknown) => console.error('Configuration could not be read:', error))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.arcadia
      .getEnabledStores()
      .then((stores) => {
        if (!cancelled) setEnabledStores(stores)
      })
      .catch((error: unknown) => console.error('Store selection could not be read:', error))
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Drops a switched-off store from the active filter.
   *
   * Left alone, the selection would still name a store the menu no longer
   * offers: the grid would filter on it, the library would look empty, and
   * nothing on screen would say why.
   */
  useEffect(() => {
    setFilter((current) => {
      const pruned = pruneStores(current.stores, enabledStores)
      // Same array back means nothing changed — returning `current` keeps
      // this from queueing a render on every enabled-store update.
      return pruned === current.stores ? current : { ...current, stores: pruned }
    })
  }, [enabledStores])

  /** Reopens the screen from the gear, with what the file says right now. */
  const openSetup = useCallback(async (): Promise<void> => {
    try {
      // Re-read rather than reuse what the gate fetched: the file may have
      // been edited by hand since, and showing a stale value would invite
      // saving it back over the newer one.
      setEnvConfig(await window.arcadia.getEnvConfig())
      setSetupIsGate(false)
      setSetupOpen(true)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setLaunchError(t().errors.envSaveFailed(message))
    }
  }, [])

  const launch = useCallback(async (entry: LibraryEntry): Promise<void> => {
    try {
      // Launching always goes through the active store entry.
      const result = await window.arcadia.launch(entry.active.id)
      setLaunchError(result.ok ? undefined : result.error)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setLaunchError(t().errors.launchFailed(message))
    }
  }, [])

  const install = useCallback(async (entry: LibraryEntry): Promise<void> => {
    const mine = ++installSequence.current
    const store = entry.active.storeId

    // Only after a pause: where the store is already running, or the
    // platform has no window agent, the answer arrives before this fires
    // and the overlay is never shown.
    const timer = setTimeout(() => {
      if (mine === installSequence.current) setInstallPending(store)
    }, OVERLAY_DELAY_MS)

    try {
      const result = await window.arcadia.install(entry.active.id)
      setLaunchError(result.ok ? undefined : result.error)
      // Not every store can install from outside. EA merely opens its
      // library — without this hint the click would look as though it had
      // done nothing at all. Steam uses it to explain a dialog that never
      // appeared.
      setNotice(result.notice)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setLaunchError(t().errors.installFailed(message))
    } finally {
      clearTimeout(timer)
      // Errors and notices are set either way — a dismissed overlay must
      // not swallow a real failure — but only the current install may
      // close the overlay.
      if (mine === installSequence.current) setInstallPending(undefined)
    }
  }, [])

  const dismissInstall = useCallback((): void => {
    setInstallPending(undefined)
    // Ends the waiting, not the download: the store already has the URI.
    void window.arcadia.cancelInstall()
  }, [])

  /**
   * Whatever startup could not report at the time.
   *
   * Asked once on mount. It outranks the other two in the banner because it
   * explains them: a library that came up empty because its database had to
   * be replaced would otherwise look like a scan that found nothing.
   *
   * A failure to ask is swallowed — being unable to read a notice is no
   * reason to put a different error in its place.
   */
  const [startupNotice, setStartupNotice] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    window.arcadia
      .getStartupNotice()
      .then((notice) => {
        if (!cancelled) setStartupNotice(notice)
      })
      .catch((caught: unknown) => console.error('Startup notice could not be read:', caught))
    return () => {
      cancelled = true
    }
  }, [])

  const visibleError = startupNotice ?? launchError ?? error

  const dismissError = (): void => {
    // The startup notice too, or the banner could never be closed: nothing
    // re-fetches it, so it would sit there for the life of the window.
    setStartupNotice(undefined)
    setLaunchError(undefined)
    clearError()
  }

  const noticeBanner =
    notice === undefined ? null : (
      <p className="banner banner--notice" role="status">
        <span>{notice}</span>
        <button
          type="button"
          className="banner__close"
          aria-label={t().common.dismissHint}
          title={t().common.dismissHint}
          onClick={() => setNotice(undefined)}
        >
          ×
        </button>
      </p>
    )

  const errorBanner =
    visibleError === undefined ? null : (
      <p className="banner banner--error" role="alert">
        <span>{visibleError}</span>
        <button
          type="button"
          className="banner__close"
          aria-label={t().common.dismissMessage}
          title={t().common.dismissMessage}
          onClick={dismissError}
        >
          ×
        </button>
      </p>
    )

  const opened = entries.find(
    (entry) => overlay?.kind === 'detail' && entry.key === overlay.key
  )

  // The entry can disappear — a scan splits a merged game apart and the key
  // points nowhere. Forget the key then, otherwise the view would jump back
  // to the page later, the moment that key happens to exist again.
  useEffect(() => {
    if (overlay?.kind === 'detail' && opened === undefined && entries.length > 0) {
      close()
    }
  }, [overlay, opened, entries.length, close])

  /**
   * Opens a newly added game once the library has actually reloaded.
   *
   * Adding a game and then having to hunt for it among 200 entries would be
   * a poor reward, but the entry does not exist in `entries` at the moment
   * the dialog closes — the reload arrives over IPC a beat later. So the id
   * is parked and acted on when the list containing it turns up.
   *
   * Matched against every source, not just the active one: a manual entry
   * whose name matches an existing game merges with it, and the merged
   * entry's active source may well be the other one.
   */
  useEffect(() => {
    if (pendingSelect === undefined) return
    const added = entries.find((entry) =>
      entry.sources.some((source) => source.id === pendingSelect)
    )
    if (added === undefined) return
    openDetail(added.key)
    setPendingSelect(undefined)
  }, [entries, pendingSelect, openDetail])

  /**
   * The mouse's back button, as in a browser: it closes the details page, or
   * clears the selection in the list.
   *
   * Two sources, because no single one covers both platforms. Windows sends
   * the thumb buttons to the window as an app-command and the page never
   * sees a DOM event; Linux delivers them as `mouseup` with button 3. On
   * Windows both can fire, which does no harm — clearing an already-cleared
   * selection is a no-op.
   *
   * `mouseup`, not `mousedown`, to match how a browser behaves: the press
   * can still be taken back by releasing elsewhere.
   */
  useEffect(() => {
    const onMouseUp = (event: MouseEvent): void => {
      const isBack = isMouseBackButton(event)
      if (!isBack && !isMouseForwardButton(event)) return
      // Chromium would otherwise try to navigate its own history. There is
      // none here — a single page — but a stray navigation would blank the
      // window with no way back.
      event.preventDefault()
      if (isBack) back()
      else forward()
    }

    window.addEventListener('mouseup', onMouseUp)
    const stopBack = window.arcadia.onNavigateBack(back)
    const stopForward = window.arcadia.onNavigateForward(forward)
    return () => {
      window.removeEventListener('mouseup', onMouseUp)
      stopBack()
      stopForward()
    }
  }, [back, forward])

  /**
   * The details page in grid mode, laid over the library rather than
   * replacing it.
   *
   * An earlier version returned early here and rendered only the page. That
   * unmounted the whole library, and React discards a scroll position along
   * with the element — so coming back always landed at the top, two hundred
   * entries away from the game that was clicked. Restoring the position by
   * hand was tried twice and neither attempt worked reliably.
   *
   * Covering the library instead removes the problem rather than
   * compensating for it: the list is never unmounted, so there is no
   * position to lose. It also matches list mode, where the library has
   * always stayed on screen.
   */
  const detailOverlay =
    view === 'grid' && opened !== undefined ? (
      <div className="detailoverlay">
        <GameDetail
          key={opened.key}
          entry={opened}
          onClose={close}
          onLaunch={(entry) => void launch(entry)}
          onToggleFavorite={(entry) => void toggleFavorite(entry)}
          onSelectStore={(entry, gameId) => void setPreferredStore(entry, gameId)}
          onInstall={(entry) => void install(entry)}
        />
      </div>
    ) : null

  return (
    <div className="app">
      <LibraryToolbar
        filter={filter}
        sort={sort}
        sortDirection={sortDirection}
        view={view}
        total={entries.length}
        shown={visible.length}
        syncing={syncing}
        availableStores={enabledStores}
        onFilterChange={setFilter}
        onSortChange={setSort}
        onSortDirectionChange={setSortDirection}
        onViewChange={(next) => {
          // Drop the selection when the mode changes. The same key means
          // "selected row" in the list and "this page fills the window" in
          // the grid — carrying it over would drop the user into a full-page
          // detail they never opened.
          close()
          setView(next)
        }}
        onAddGame={() => setAddOpen(true)}
        onSync={() => void sync()}
        onOpenSetup={() => void openSetup()}
      />

      {errorBanner}
      {noticeBanner}

      {setupOpen && envConfig !== undefined && (
        <SetupDialog
          values={envConfig.values}
          path={envConfig.path}
          firstRun={setupIsGate}
          enabledStores={enabledStores}
          onEnabledStoresChange={(stores) => {
            // Optimistic: the checkbox reacts at once and the library
            // reloads when main sends library:changed. A failed write is
            // logged, and the next start reads what is actually stored.
            setEnabledStores(stores)
            window.arcadia
              .setEnabledStores(stores)
              .catch((error: unknown) =>
                console.error('Store selection could not be saved:', error)
              )
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}

      {addOpen && (
        <AddGameDialog
          // The same list the store filter offers. A game filed under a
          // switched-off store would be written and then filtered straight
          // back out of the visible library, with no way to reach it again.
          availableStores={enabledStores}
          onClose={() => setAddOpen(false)}
          // Only remembered here, not selected: the library reloads through
          // an IPC event, so at this moment `entries` is still the list from
          // before the game existed. Looking it up now would always miss.
          onAdded={setPendingSelect}
        />
      )}

      {installPending !== undefined && (
        <InstallOverlay store={STORE_LABELS[installPending]} onDismiss={dismissInstall} />
      )}

      <Library
        entries={entries}
        visible={visible}
        view={view}
        loading={loading}
        scanning={syncing}
        selected={opened}
        onSelect={(entry) => openDetail(entry.key)}
        onLaunch={(entry) => void launch(entry)}
        onInstall={(entry) => void install(entry)}
        onToggleFavorite={(entry) => void toggleFavorite(entry)}
        onSelectStore={(entry, gameId) => void setPreferredStore(entry, gameId)}
        onSplit={(entry) => void setSplit(entry, true)}
      />

      {detailOverlay}
    </div>
  )
}
