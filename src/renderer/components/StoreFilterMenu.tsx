import { useCallback, useRef, useState, type ReactElement } from 'react'
import { STORE_IDS, type StoreId } from '@shared/types'
import { t } from '@shared/i18n'
import { storeFilterLabel, toggleStore } from '../filter'
import { useDismiss } from '../hooks/useDismiss'
import { STORE_LABELS } from './storeLabels'

interface Props {
  stores: StoreId[]
  onChange: (stores: StoreId[]) => void
}

/**
 * The store filter: any combination of stores, not one at a time.
 *
 * A popover of checkboxes rather than a `<select multiple>`. The native
 * control renders as an always-expanded list box, which would break the
 * single-row toolbar, and it only multi-selects through ctrl-click — a
 * gesture nothing on screen hints at.
 */
export function StoreFilterMenu({ stores, onChange }: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useDismiss(open, root, close)

  return (
    <div className="popover" ref={root}>
      <button
        type="button"
        className="popover__trigger"
        aria-label={t().toolbar.storeFilterLabel}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="popover__triggertext">{storeFilterLabel(stores)}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="popover__panel" role="menu">
          <p className="popover__label">{t().toolbar.storeFilterLabel}</p>

          {/* The neutral state, reachable in one click. Unticking four boxes
              to get back to the whole library would be a poor trade. */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={stores.length === 0}
            className={`popover__item${stores.length === 0 ? ' popover__item--active' : ''}`}
            onClick={() => {
              onChange([])
              close()
            }}
          >
            <span className="popover__check" aria-hidden="true">
              {stores.length === 0 ? '✓' : ''}
            </span>
            {t().toolbar.allStores}
          </button>

          {STORE_IDS.map((id) => {
            const selected = stores.includes(id)
            return (
              <button
                key={id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                className={`popover__item${selected ? ' popover__item--active' : ''}`}
                // Stays open: picking three stores should cost three clicks,
                // not three trips back to the button.
                onClick={() => onChange(toggleStore(stores, id))}
              >
                <span className="popover__check" aria-hidden="true">
                  {selected ? '✓' : ''}
                </span>
                {STORE_LABELS[id] ?? id}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
