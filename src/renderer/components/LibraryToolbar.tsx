import type { ReactElement } from 'react'
import { t } from '@shared/i18n'
import type { LibraryFilter, SharedFilter, SortDirection, SortKey, ViewMode } from '../filter'
import { SettingsMenu } from './SettingsMenu'
import { StoreFilterMenu } from './StoreFilterMenu'

interface Props {
  filter: LibraryFilter
  sort: SortKey
  sortDirection: SortDirection
  view: ViewMode
  total: number
  shown: number
  syncing: boolean
  onFilterChange: (filter: LibraryFilter) => void
  onSortChange: (sort: SortKey) => void
  onSortDirectionChange: (direction: SortDirection) => void
  onViewChange: (view: ViewMode) => void
  onAddGame: () => void
  onSync: () => void
  onOpenSetup: () => void
}

export function LibraryToolbar(props: Props): ReactElement {
  const { filter, onFilterChange } = props

  // Read once per render so a language switch reaches every label at the
  // same time rather than half of them.
  const sortLabels: Record<SortKey, string> = t().toolbar.sort
  const directionLabel = t().toolbar.sortDirectionLabel(
    t().toolbar.sortDirection[props.sortDirection]
  )
  const refreshLabel = props.syncing ? t().toolbar.refreshing : t().toolbar.refresh

  return (
    <header className="toolbar">
      <input
        type="search"
        className="toolbar__search"
        placeholder={t().toolbar.searchPlaceholder}
        value={filter.search}
        onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
      />

      <StoreFilterMenu
        stores={filter.stores}
        onChange={(stores) => onFilterChange({ ...filter, stores })}
      />

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

      {/* The accessible name states the direction rather than leaving a
          screen reader with a bare arrow. */}
      <button
        type="button"
        className="button button--icon"
        aria-label={directionLabel}
        title={directionLabel}
        onClick={() => props.onSortDirectionChange(props.sortDirection === 'asc' ? 'desc' : 'asc')}
      >
        <span aria-hidden="true">{props.sortDirection === 'asc' ? '↑' : '↓'}</span>
      </button>

      {/* Stacked, not side by side: two short checkboxes cost as much of the
          row as a whole dropdown, and the row has none to spare. Vertically
          they take one column's width and no more height than the fields
          beside them. */}
      <div className="toolbar__toggles">
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
      </div>

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

      {/* The count is the one label in the row whose width follows the data,
          and the search field beside it grows into whatever it gives up — so
          filtering the library slid every control between the two sideways,
          the checkbox that was just clicked included. A hidden copy at the
          widest the label can ever be — `shown` at its maximum is `total` —
          holds the width still. */}
      <span className="toolbar__count">
        <span className="toolbar__countsizer" aria-hidden="true">
          {t().toolbar.shownOfTotal(props.total, props.total)}
        </span>
        <span className="toolbar__counttext">
          {t().toolbar.shownOfTotal(props.shown, props.total)}
        </span>
      </span>

      {/* Icon only, so the label lives in the tooltip and the accessible
          name — and keeps naming the state while a scan runs, which the
          disabled look alone does not spell out. */}
      <button
        type="button"
        className="button button--icon"
        disabled={props.syncing}
        aria-label={refreshLabel}
        title={refreshLabel}
        onClick={props.onSync}
      >
        <span aria-hidden="true">⟳</span>
      </button>

      <button type="button" className="button" onClick={props.onAddGame}>
        + {t().toolbar.addGame}
      </button>

      <SettingsMenu onOpenSetup={props.onOpenSetup} />
    </header>
  )
}
