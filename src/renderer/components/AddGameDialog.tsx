import { useEffect, useRef, useState, type ReactElement } from 'react'
import { STORE_IDS, type StoreId } from '@shared/types'
import { storeGameIdLooksValid } from '@shared/manual'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './storeLabels'

interface Props {
  onClose: () => void
  /** Called with the new entry's id, so the caller can select it. */
  onAdded: (gameId: string) => void
}

/**
 * Records a game no adapter can see.
 *
 * The store identifier is optional on purpose: for the case this exists for
 * — an EA library that only reports what has been installed here — the user
 * has no way of knowing it. Left empty, the entry still gets artwork and a
 * description through the usual Steam matching; it just cannot be launched,
 * because no store knows the generated identifier.
 */
export function AddGameDialog({ onClose, onAdded }: Props): ReactElement {
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState<StoreId>('ea')
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
  const idLooksWrong = trimmedId !== '' && !storeGameIdLooksValid(storeId, trimmedId)
  const canSubmit = name.trim() !== '' && !idLooksWrong && !saving

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
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
          <select
            className="modal__search"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value as StoreId)}
          >
            {STORE_IDS.map((id) => (
              <option key={id} value={id}>
                {STORE_LABELS[id] ?? id}
              </option>
            ))}
          </select>
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
