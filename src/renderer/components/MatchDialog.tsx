import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import type { AppSuggestion } from '@shared/ipc'
import { t } from '@shared/i18n'

interface Props {
  entry: LibraryEntry
  onClose: () => void
}

/** How long to wait after the last keystroke before searching. */
const TYPING_PAUSE_MS = 250

/**
 * Correcting a match by hand.
 *
 * Not a nicety but load-bearing: name matching fails to find 28 of the 239
 * games — titles carrying trademark symbols, test branches such as
 * "Rust - Staging Branch", and games that simply do not exist on Steam.
 * Without this route they would stay without details forever.
 */
export function MatchDialog({ entry, onClose }: Props): ReactElement {
  const [query, setQuery] = useState(entry.name)
  const [matches, setMatches] = useState<AppSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  // Sequence number per search: a slow earlier answer must not overwrite a
  // faster later one.
  const searchSequence = useRef(0)

  useEffect(() => {
    const text = query.trim()
    if (text === '') {
      setMatches([])
      return
    }

    // Only search after a typing pause. The list holds 176,000 entries and
    // is walked on every call — once per keystroke would be noticeable, and
    // the main process serves nobody else while it runs.
    const timer = setTimeout(() => {
      const mine = ++searchSequence.current
      setSearching(true)
      window.arcadia
        .searchApps(text)
        .then((found) => {
          if (mine !== searchSequence.current) return
          setMatches(found)
          setError(undefined)
        })
        .catch((caught: unknown) => {
          if (mine !== searchSequence.current) return
          setError(caught instanceof Error ? caught.message : String(caught))
        })
        .finally(() => {
          if (mine === searchSequence.current) setSearching(false)
        })
    }, TYPING_PAUSE_MS)

    return () => clearTimeout(timer)
  }, [query])

  const applyMatch = async (appId: number): Promise<void> => {
    setSaving(true)
    try {
      const result = await window.arcadia.setMatch(entry.key, appId)
      if (result.ok) onClose()
      else setError(result.error)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t().matchDialog.label}>
      <div className="modal__box">
        <h2 className="modal__title">{t().matchDialog.title}</h2>
        <p className="modal__hint">{t().matchDialog.hint}</p>

        <input
          className="modal__search"
          type="search"
          value={query}
          autoFocus
          placeholder={t().matchDialog.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />

        {error !== undefined && <p className="modal__error">{error}</p>}

        <ul className="modal__list">
          {searching && matches.length === 0 && (
            <li className="modal__empty">{t().matchDialog.searching}</li>
          )}
          {!searching && matches.length === 0 && query.trim() !== '' && (
            <li className="modal__empty">{t().matchDialog.nothingFound}</li>
          )}
          {matches.map((app) => (
            <li key={app.appId}>
              <button
                type="button"
                className="modal__match"
                disabled={saving}
                onClick={() => void applyMatch(app.appId)}
              >
                <span className="modal__name">{app.name}</span>
                <span className="modal__appid">{app.appId}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="modal__footer">
          <button type="button" className="button" onClick={onClose}>
            {t().common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
