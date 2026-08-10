import { useCallback, useEffect, useState } from 'react'
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

  const load = useCallback(async (force: boolean): Promise<void> => {
    setLoading(true)
    try {
      setList(force ? await window.arcadia.refreshFreebies() : await window.arcadia.getFreebies())
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
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
