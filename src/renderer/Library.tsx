import type { ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'
import type { ViewMode } from './filter'
import { GameCard } from './components/GameCard'
import { ListRow } from './components/ListRow'
import { GameDetail } from './pages/GameDetail'

interface Props {
  entries: LibraryEntry[]
  visible: LibraryEntry[]
  view: ViewMode
  loading: boolean
  selected: LibraryEntry | undefined
  onSelect: (entry: LibraryEntry) => void
  onLaunch: (entry: LibraryEntry) => void
  onInstall: (entry: LibraryEntry) => void
  onToggleFavorite: (entry: LibraryEntry) => void
  onSelectStore: (entry: LibraryEntry, gameId: string | undefined) => void
  onSplit: (entry: LibraryEntry) => void
}

/**
 * The three states a library can be in, in the order they have to be
 * checked.
 *
 * Kept apart deliberately: "still loading", "nothing found at all" and
 * "the filters exclude everything" call for different reactions. One shared
 * "no games" would make a too-narrow filter look like a broken library.
 */
function emptyState(loading: boolean, total: number, shown: number): string | undefined {
  if (loading) return t().library.loading
  if (total === 0) return t().library.empty
  if (shown === 0) return t().library.noMatches
  return undefined
}

export function Library(props: Props): ReactElement {
  const { entries, visible, view, loading, selected } = props
  const hint = emptyState(loading, entries.length, visible.length)

  if (view === 'list') {
    return (
      <main className="library library--split">
        <div className="listpane">
          {hint !== undefined && <p className="hint hint--left">{hint}</p>}
          <ul className="listpane__items">
            {visible.map((entry) => (
              <ListRow
                key={entry.key}
                entry={entry}
                selected={entry.key === selected?.key}
                onSelect={props.onSelect}
              />
            ))}
          </ul>
        </div>

        <div className="detailpane">
          {selected === undefined ? (
            <p className="hint">{t().library.nothingSelected}</p>
          ) : (
            <GameDetail
              // Remount on a different game: the details page keeps state of
              // its own — which screenshot is open, whether the description
              // is expanded — and carrying that across to another game would
              // show the wrong one expanded.
              key={selected.key}
              entry={selected}
              variant="pane"
              onClose={() => undefined}
              onLaunch={props.onLaunch}
              onToggleFavorite={props.onToggleFavorite}
              onSelectStore={props.onSelectStore}
              onInstall={props.onInstall}
            />
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="library">
      <div className="grid">
        {hint !== undefined && <p className="hint">{hint}</p>}

        {visible.map((entry) => (
          <GameCard
            key={entry.key}
            entry={entry}
            onLaunch={props.onLaunch}
            onToggleFavorite={props.onToggleFavorite}
            onSelectStore={props.onSelectStore}
            onSplit={props.onSplit}
            onOpen={props.onSelect}
            onInstall={props.onInstall}
          />
        ))}
      </div>
    </main>
  )
}
