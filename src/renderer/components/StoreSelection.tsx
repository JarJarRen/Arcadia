import { useEffect, useState, type ReactElement } from 'react'
import { STORE_IDS, type AvailabilityResult, type StoreId } from '@shared/types'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './storeLabels'

interface Props {
  enabled: StoreId[]
  onChange: (stores: StoreId[]) => void
}

/**
 * The store list in the configuration screen.
 *
 * Its own component rather than more markup in SetupDialog: the dialog is
 * about the API keys, this is about which stores exist, and this one has an
 * async probe of its own. The dialog stays the shell that arranges them.
 *
 * The probe never gates the checkboxes. It reads the registry through four
 * adapters and can take a moment; a list that could not be ticked until it
 * answered would feel broken for exactly as long as the slowest store.
 */
export function StoreSelection({ enabled, onChange }: Props): ReactElement {
  const [availability, setAvailability] = useState<
    Record<string, AvailabilityResult> | undefined
  >()

  useEffect(() => {
    let cancelled = false
    window.arcadia
      .getStoreAvailability()
      .then((result) => {
        if (!cancelled) setAvailability(result)
      })
      // Swallowed on purpose: not knowing whether a store is installed is no
      // reason to stop someone choosing it. The row keeps saying "checking".
      .catch((error: unknown) => console.error('Stores could not be probed:', error))
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (id: StoreId): void => {
    const next = enabled.includes(id)
      ? enabled.filter((store) => store !== id)
      : [...enabled, id]
    // Canonical order, so the stored value does not depend on the order the
    // boxes happened to be ticked in.
    onChange(STORE_IDS.filter((store) => next.includes(store)))
  }

  return (
    <fieldset className="modal__group">
      <legend className="modal__label">{t().setup.storesTitle}</legend>
      <p className="modal__sublabel">{t().setup.storesHint}</p>

      {STORE_IDS.map((id) => (
        <label className="modal__toggle" key={id}>
          <input
            type="checkbox"
            checked={enabled.includes(id)}
            onChange={() => toggle(id)}
          />
          <span>
            {STORE_LABELS[id] ?? id}
            <span className="modal__sublabel">{note(availability, id)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * What a row says about the store beneath its name.
 *
 * Limitations as well as the reason: that is how a Ubisoft user learns their
 * owned games come from a local cache without having to read the source.
 */
function note(
  availability: Record<string, AvailabilityResult> | undefined,
  id: StoreId
): string {
  if (availability === undefined) return t().setup.storeChecking
  const result = availability[id]
  if (result === undefined) return t().setup.storeChecking
  if (!result.available) return result.reason ?? t().setup.storeNotFound
  const limitations = result.limitations ?? []
  return limitations.length === 0
    ? t().setup.storeDetected
    : `${t().setup.storeDetected} — ${limitations.join(' ')}`
}
