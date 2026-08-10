import { useCallback, useEffect, useRef, useState } from 'react'
import type { Freebie, FreebieList } from '@shared/freebies'
import { t } from '@shared/i18n'

const EMPTY: FreebieList = { current: [], upcoming: [], failures: [] }

export interface FreebieControls {
  list: FreebieList
  loading: boolean
  error?: string
  refresh: () => void
  claim: (freebie: Freebie) => Promise<void>
}

export function useFreebies(): FreebieControls {
  const [list, setList] = useState<FreebieList>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Mount, onFreebiesChanged and the refresh button can each start a load
  // independently, and main fires onFreebiesChanged with no debounce. If two
  // loads are in flight, whichever resolves last wins the state regardless
  // of which was started last — a stale answer can overwrite a fresher one.
  // Bumping this on every load and checking it after the await lets a load
  // that has been superseded discard its result instead of applying it.
  const generation = useRef(0)

  const load = useCallback(async (force: boolean): Promise<void> => {
    const thisGeneration = ++generation.current
    setLoading(true)
    try {
      const result = force ? await window.arcadia.refreshFreebies() : await window.arcadia.getFreebies()
      if (thisGeneration !== generation.current) return
      setList(result)
      setError(undefined)
    } catch (caught) {
      if (thisGeneration !== generation.current) return
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (thisGeneration === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    // The main process refreshes behind the first answer and confirms
    // claims after a scan; both arrive as this event.
    return window.arcadia.onFreebiesChanged(() => {
      void load(false)
    })
  }, [load])

  const claim = useCallback(
    async (freebie: Freebie): Promise<void> => {
      // The id, never the address. Main looks the row up and validates it.
      const result = await window.arcadia.claimFreebie(freebie.id)
      if (!result.ok) setError(result.error ?? t().freebies.unavailable)
    },
    []
  )

  return { list, loading, error, refresh: () => void load(true), claim }
}
