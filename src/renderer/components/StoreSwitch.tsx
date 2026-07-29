import type { ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './storeLabels'

interface Props {
  entry: LibraryEntry
  onSelect: (gameId: string) => void
  onSplit: () => void
}

/**
 * Picks the store a multiply-registered game launches through.
 *
 * Only shown when there is something to choose. The stores are not
 * interchangeable — achievements, cloud saves and the overlay hang off
 * this — so the app does not decide it silently on the user's behalf.
 */
export function StoreSwitch({ entry, onSelect, onSplit }: Props): ReactElement | null {
  if (entry.sources.length < 2) return null

  return (
    <div className="storeswitch">
      <span className="storeswitch__label">{t().storeSwitch.launchVia}</span>
      {entry.sources.map((source) => {
        const active = source.id === entry.active.id
        const label = STORE_LABELS[source.storeId] ?? source.storeId
        return (
          <button
            key={source.id}
            type="button"
            className={`storeswitch__option ${active ? 'storeswitch__option--active' : ''}`}
            aria-pressed={active}
            // Sources that are not installed stay selectable: the store can
            // start the installation, and the choice should be settable in
            // advance.
            title={
              source.installed
                ? t().storeSwitch.launchViaStore(label)
                : t().storeSwitch.notInstalledAtStore(label)
            }
            onClick={() => onSelect(source.id)}
          >
            {label}
            {!source.installed && <span className="storeswitch__hint"> ⚠</span>}
          </button>
        )
      })}
      <button
        type="button"
        className="storeswitch__split"
        title={t().storeSwitch.splitTitle}
        onClick={onSplit}
      >
        {t().storeSwitch.split}
      </button>
    </div>
  )
}
