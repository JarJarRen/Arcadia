import { useEffect, useRef, useState, type ReactElement } from 'react'
import { type StoreId } from '@shared/types'
import { storeGameIdLooksValid } from '@shared/manual'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './storeLabels'

interface Props {
  /**
   * The stores that are switched on, exactly as the toolbar's filter takes
   * them.
   *
   * Offering the rest would let somebody file a game under a store the
   * visible library filters straight back out: the row exists, nothing
   * shows it, removal is only reachable from a grid row, and adding it
   * again fails as a duplicate.
   */
  availableStores: StoreId[]
  onClose: () => void
  /** Called with the new entry's id, so the caller can select it. */
  onAdded: (gameId: string) => void
}

/** The store this exists for, when it is on the list. */
const PREFERRED: StoreId = 'ea'

/**
 * Records a game no adapter can see.
 *
 * The store identifier is optional on purpose: for the case this exists for
 * — an EA library that only reports what has been installed here — the user
 * has no way of knowing it. Left empty, the entry still gets artwork and a
 * description through the usual Steam matching; it just cannot be launched,
 * because no store knows the generated identifier.
 */
export function AddGameDialog({ availableStores, onClose, onAdded }: Props): ReactElement {
  const [name, setName] = useState('')
  // Undefined only when every store is switched off, which the dialog says
  // rather than offering a choice that cannot be honoured.
  const [storeId, setStoreId] = useState<StoreId | undefined>(
    availableStores.includes(PREFERRED) ? PREFERRED : availableStores[0]
  )
  const [storeGameId, setStoreGameId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmedId = storeGameId.trim()
  // Checked while typing rather than on submit: the store decides the shape,
  // and switching the store can invalidate an identifier already entered.
  const idLooksWrong =
    storeId !== undefined && trimmedId !== '' && !storeGameIdLooksValid(storeId, trimmedId)
  const canSubmit = storeId !== undefined && name.trim() !== '' && !idLooksWrong && !saving

  const submit = async (): Promise<void> => {
    if (!canSubmit || storeId === undefined) return
    setSaving(true)
    setError(undefined)
    try {
      const result = await window.arcadia.addManualGame({
        storeId,
        name: name.trim(),
        ...(trimmedId === '' ? {} : { storeGameId: trimmedId })
      })
      if (result.ok && result.id !== undefined) {
        onAdded(result.id)
        onClose()
      } else {
        // The main process explains the actual reason — duplicate, bad
        // identifier — so it is shown rather than replaced by something
        // generic.
        setError(result.error)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t().addDialog.label}>
      <div className="modal__box">
        <h2 className="modal__title">{t().addDialog.title}</h2>
        <p className="modal__hint">{t().addDialog.hint}</p>

        <label className="modal__field">
          <span className="modal__label">{t().addDialog.nameLabel}</span>
          <input
            ref={field}
            className="modal__search"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </label>

        <label className="modal__field">
          <span className="modal__label">{t().addDialog.storeLabel}</span>
          {storeId === undefined ? (
            <span className="modal__sublabel">{t().addDialog.noStores}</span>
          ) : (
            <select
              className="modal__search"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value as StoreId)}
            >
              {availableStores.map((id) => (
                <option key={id} value={id}>
                  {STORE_LABELS[id] ?? id}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="modal__field">
          <span className="modal__label">{t().addDialog.idLabel}</span>
          <input
            className="modal__search"
            value={storeGameId}
            onChange={(event) => setStoreGameId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
          <span className="modal__sublabel">{t().addDialog.idHint}</span>
        </label>

        {idLooksWrong && (
          <p className="modal__error">{t().errors.invalidInput}</p>
        )}
        {error !== undefined && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            {t().addDialog.cancel}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {t().addDialog.submit}
          </button>
        </div>
      </div>
    </div>
  )
}
