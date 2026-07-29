import type { ReactElement } from 'react'
import { STORE_IDS } from '@shared/types'
import { t } from '@shared/i18n'
import type { LibraryFilter, SharedFilter, SortKey, ViewMode } from '../filter'
import { STORE_LABELS } from './storeLabels'
import { LanguageMenu } from './LanguageMenu'

interface Props {
  filter: LibraryFilter
  sort: SortKey
  view: ViewMode
  total: number
  shown: number
  syncing: boolean
  onFilterChange: (filter: LibraryFilter) => void
  onSortChange: (sort: SortKey) => void
  onViewChange: (view: ViewMode) => void
  onAddGame: () => void
  onSync: () => void
}

export function LibraryToolbar(props: Props): ReactElement {
  const { filter, onFilterChange } = props

  // Read once per render so a language switch reaches every label at the
  // same time rather than half of them.
  const sortLabels: Record<SortKey, string> = t().toolbar.sort

  return (
    <header className="toolbar">
      <input
        type="search"
        className="toolbar__search"
        placeholder={t().toolbar.searchPlaceholder}
        value={filter.search}
        onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
      />

      <select
        className="toolbar__select"
        value={filter.store}
        aria-label={t().toolbar.storeFilterLabel}
        onChange={(event) =>
          onFilterChange({ ...filter, store: event.target.value as LibraryFilter['store'] })
        }
      >
        <option value="all">{t().toolbar.allStores}</option>
        {STORE_IDS.map((id) => (
          <option key={id} value={id}>
            {STORE_LABELS[id] ?? id}
          </option>
        ))}
      </select>

      <select
        className="toolbar__select"
        value={props.sort}
        aria-label={t().toolbar.sortLabel}
        onChange={(event) => props.onSortChange(event.target.value as SortKey)}
      >
        {Object.entries(sortLabels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>

      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={filter.onlyInstalled}
          onChange={(event) =>
            onFilterChange({ ...filter, onlyInstalled: event.target.checked })
          }
        />
        {t().toolbar.onlyInstalled}
      </label>

      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={filter.onlyFavorites}
          onChange={(event) =>
            onFilterChange({ ...filter, onlyFavorites: event.target.checked })
          }
        />
        {t().toolbar.onlyFavorites}
      </label>

      {/* Three states, so that "hide the shared ones" is reachable — a
          checkbox could only ever show them. */}
      <select
        className="toolbar__select"
        value={filter.shared}
        aria-label={t().toolbar.sharedLabel}
        onChange={(event) =>
          onFilterChange({ ...filter, shared: event.target.value as SharedFilter })
        }
      >
        <option value="all">{t().toolbar.shared.all}</option>
        <option value="only">{t().toolbar.shared.only}</option>
        <option value="exclude">{t().toolbar.shared.exclude}</option>
      </select>

      {/* A segmented toggle rather than a dropdown: this switches a mode,
          it does not filter anything, and among eight filter controls a
          ninth select disappeared. Both states are visible at once, so the
          current one is readable without opening anything. */}
      <div className="viewtoggle" role="group" aria-label={t().toolbar.viewLabel}>
        {(['grid', 'list'] as const).map((mode: ViewMode) => (
          <button
            key={mode}
            type="button"
            className={`viewtoggle__option${
              props.view === mode ? ' viewtoggle__option--active' : ''
            }`}
            data-view={mode}
            aria-pressed={props.view === mode}
            title={t().toolbar.view[mode]}
            onClick={() => props.onViewChange(mode)}
          >
            <span aria-hidden="true">{mode === 'grid' ? '▦' : '☰'}</span>
            <span className="viewtoggle__text">{t().toolbar.view[mode]}</span>
          </button>
        ))}
      </div>

      <span className="toolbar__count">
        {t().toolbar.shownOfTotal(props.shown, props.total)}
      </span>

      <button type="button" className="button" disabled={props.syncing} onClick={props.onSync}>
        {props.syncing ? t().toolbar.refreshing : t().toolbar.refresh}
      </button>

      <button type="button" className="button" onClick={props.onAddGame}>
        + {t().toolbar.addGame}
      </button>

      <LanguageMenu />
    </header>
  )
}
