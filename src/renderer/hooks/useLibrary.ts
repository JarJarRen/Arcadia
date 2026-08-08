import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'

export interface Library {
  entries: LibraryEntry[]
  loading: boolean
  syncing: boolean
  error: string | undefined
  clearError: () => void
  sync: () => Promise<void>
  toggleFavorite: (entry: LibraryEntry) => Promise<void>
  setPreferredStore: (entry: LibraryEntry, gameId: string | undefined) => Promise<void>
  setSplit: (entry: LibraryEntry, split: boolean) => Promise<void>
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useLibrary(): Library {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // Sequence number per load: if an older answer arrives after a newer one,
  // it is discarded.
  const loadSequence = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++loadSequence.current
    try {
      const loaded = await window.arcadia.getGames()
      if (mine !== loadSequence.current) return
      setEntries(loaded)
      setError(undefined)
    } catch (caught) {
      if (mine !== loadSequence.current) return
      setError(t().errors.libraryLoadFailed(describeError(caught)))
    } finally {
      if (mine === loadSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // Return the cleanup function, otherwise listeners pile up on every
    // React remount.
    return window.arcadia.onLibraryChanged(() => void reload())
  }, [reload])

  /**
   * Picks up a scan that was already running before this mounted.
   *
   * The main process starts one as the app opens, well before the bundle has
   * finished compiling — so the `true` it sends arrives with nobody
   * listening. Subscribing alone would therefore show nothing at all on a
   * first start, which is the case that needs it most. Asking once on mount
   * covers the gap; the subscription covers everything after.
   *
   * A failure is swallowed: not knowing whether a scan is running is no
   * reason to keep the library off the screen.
   */
  useEffect(() => {
    let cancelled = false

    window.arcadia
      .isScanning()
      .then((scanning) => {
        if (!cancelled) setSyncing(scanning)
      })
      .catch(() => undefined)

    const stop = window.arcadia.onScanningChanged((scanning) => {
      if (!cancelled) setSyncing(scanning)
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  /**
   * `syncing` is deliberately not set here.
   *
   * The main process reports it, for this scan and the one it starts itself
   * alike, and one source of truth is the point. Setting it here as well
   * would clear the indicator when *this* scan returned even though the
   * startup scan was still running behind it — the exact overlap the depth
   * counter in scan-state.ts exists to get right.
   */
  const sync = useCallback(async () => {
    try {
      const result = await window.arcadia.sync()
      // Surface partially failed scans: otherwise they would only land in
      // the terminal, and a click on Refresh would look as though
      // everything had gone well.
      const failed = result.stores.filter((store) => !store.ok)
      setError(
        failed.length === 0
          ? undefined
          : failed.map((store) => store.storeId + ': ' + store.error).join(' - ')
      )
    } catch (caught) {
      setError(t().errors.refreshFailed(describeError(caught)))
    }
  }, [])

  const writing = useCallback(
    async (action: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run()
      } catch (caught) {
        setError(t().errors.actionFailed(action, describeError(caught)))
      }
    },
    []
  )

  const toggleFavorite = useCallback(
    (entry: LibraryEntry) =>
      writing(t().errors.setFavourite, () =>
        window.arcadia.setFavorite(entry.key, !entry.favorite)
      ),
    [writing]
  )

  const setPreferredStore = useCallback(
    (entry: LibraryEntry, gameId: string | undefined) =>
      writing(t().errors.saveStoreChoice, () =>
        window.arcadia.setPreferredStore(entry.key, gameId)
      ),
    [writing]
  )

  const setSplit = useCallback(
    (entry: LibraryEntry, split: boolean) =>
      writing(t().errors.saveSplit, () => window.arcadia.setSplit(entry.key, split)),
    [writing]
  )

  const clearError = useCallback(() => setError(undefined), [])

  return {
    entries,
    loading,
    syncing,
    error,
    clearError,
    sync,
    toggleFavorite,
    setPreferredStore,
    setSplit
  }
}
