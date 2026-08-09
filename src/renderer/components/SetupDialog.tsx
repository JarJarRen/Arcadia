import { useEffect, useRef, useState, type ReactElement } from 'react'
import { t } from '@shared/i18n'
import { emptyEnvConfig, type EnvConfigKey, type EnvConfigValues } from '@shared/env-config'
import type { StoreId } from '@shared/types'
import { StoreSelection } from './StoreSelection'

interface Props {
  values: EnvConfigValues
  path: string
  /**
   * Whether this is the first start, where the dialog is the gate.
   *
   * There is no cancel then — skipping is the way past it. Opened from the
   * gear the question has long been answered, so closing it unchanged has
   * to be possible.
   */
  firstRun: boolean
  /** The stores switched on right now, held by App so the filter sees them too. */
  enabledStores: StoreId[]
  /** Saves at once — no restart, unlike the keys below it. */
  onEnabledStoresChange: (stores: StoreId[]) => void
  onClose: () => void
}

interface Field {
  key: EnvConfigKey
  label: string
  hint: string
  url: string
}

/** The three keys, in the order the `.env` template lists them. */
function fields(): Field[] {
  return [
    {
      key: 'STEAM_WEB_API_KEY',
      label: t().setup.steamKeyLabel,
      hint: t().setup.steamKeyHint,
      url: 'https://steamcommunity.com/dev/apikey'
    },
    {
      key: 'STEAM_ID64',
      label: t().setup.steamIdLabel,
      hint: t().setup.steamIdHint,
      url: 'https://steamcommunity.com/'
    },
    {
      key: 'STEAMGRIDDB_API_KEY',
      label: t().setup.gridKeyLabel,
      hint: t().setup.gridKeyHint,
      url: 'https://www.steamgriddb.com/profile/preferences/api'
    }
  ]
}

/**
 * The configuration screen for the API keys.
 *
 * Shown on the first start, because nothing else ever asked for the keys:
 * they had to be written into a `.env` by hand, from a template the user
 * first had to find. An installed copy was therefore normally run by someone
 * who never learned why their library showed a third of their games.
 *
 * Skipping is a first-class answer, not a way of putting it off — all three
 * keys really are optional, and the marker is written either way so the
 * question is asked exactly once.
 */
export function SetupDialog({
  values,
  path,
  firstRun,
  enabledStores,
  onEnabledStoresChange,
  onClose
}: Props): ReactElement {
  const [edited, setEdited] = useState<EnvConfigValues>({ ...emptyEnvConfig(), ...values })
  const [skip, setSkip] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  // Escape closes only where closing is allowed. On the first start it would
  // otherwise dismiss the gate without answering it, and the dialog would be
  // back on the next launch.
  useEffect(() => {
    if (firstRun) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [firstRun, onClose])

  const submit = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      // Skipping sends nothing: the marker is written, the keys in the file
      // stay as they are.
      const result = await window.arcadia.saveEnvConfig(skip ? undefined : edited)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // On a change the main process is already restarting the app. Closing
      // would flash the library for the moment it takes.
      if (result.restarting) setRestarting(true)
      else onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const confirmLabel = skip
    ? t().setup.continueWithout
    : firstRun
      ? t().setup.saveAndRestart
      : t().setup.save

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t().setup.label}>
      <div className="modal__box modal__box--wide">
        <h2 className="modal__title">{t().setup.title}</h2>
        <p className="modal__hint">{t().setup.intro}</p>
        {firstRun && <p className="modal__hint">{t().setup.firstRunHint}</p>}

        <StoreSelection enabled={enabledStores} onChange={onEnabledStoresChange} />

        {fields().map((field, index) => (
          <label className="modal__field" key={field.key}>
            <span className="modal__label">{field.label}</span>
            <input
              ref={index === 0 ? first : undefined}
              className="modal__search"
              value={edited[field.key]}
              disabled={skip || restarting}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                setEdited({ ...edited, [field.key]: event.target.value })
              }
            />
            <span className="modal__sublabel">
              {field.hint}{' '}
              {/* Opens in the system browser: the window's open handler
                  denies in-app navigation and hands the URL to the shell. */}
              <a className="modal__link" href={field.url} target="_blank" rel="noreferrer">
                {t().setup.whereToGet}
              </a>
            </span>
          </label>
        ))}

        <label className="modal__toggle">
          <input
            type="checkbox"
            checked={skip}
            disabled={restarting}
            onChange={(event) => setSkip(event.target.checked)}
          />
          <span>
            {t().setup.skip}
            <span className="modal__sublabel">{t().setup.skipHint}</span>
          </span>
        </label>

        <p className="modal__sublabel">{t().setup.fileHint(path)}</p>

        {error !== undefined && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          {!firstRun && (
            <button type="button" className="button" disabled={restarting} onClick={onClose}>
              {t().setup.close}
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={saving || restarting}
            onClick={() => void submit()}
          >
            {restarting ? t().setup.restarting : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
