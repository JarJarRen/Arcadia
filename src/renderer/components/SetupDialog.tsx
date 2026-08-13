import { useEffect, useRef, useState, type ReactElement } from 'react'
import { t } from '@shared/i18n'
import { emptyEnvConfig, type EnvConfigValues } from '@shared/env-config'
import type { StoreId } from '@shared/types'
import { StoreSelection } from './StoreSelection'
import { ApiKeyFields } from './ApiKeyFields'

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
  const [tab, setTab] = useState<'stores' | 'keys'>('stores')
  const storesTab = useRef<HTMLButtonElement>(null)
  const keysTab = useRef<HTMLButtonElement>(null)

  // The first key field is no longer on screen at mount, so the tab it lives
  // behind is what gets the focus instead.
  useEffect(() => {
    storesTab.current?.focus()
  }, [])

  // Keeps the old behaviour — you can start typing as soon as the fields are
  // there — moved to the moment they actually appear.
  useEffect(() => {
    if (tab === 'keys') first.current?.focus()
  }, [tab])

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

  const tabs = [
    { id: 'stores' as const, label: t().setup.storesTitle, ref: storesTab },
    { id: 'keys' as const, label: t().setup.tabKeys, ref: keysTab }
  ]

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t().setup.label}>
      <div className="modal__box modal__box--wide">
        <h2 className="modal__title">{t().setup.title}</h2>
        {firstRun && <p className="modal__hint">{t().setup.firstRunHint}</p>}

        {/* Both tabs stay in the tab order and either arrow moves to the
            other one. The WAI-ARIA pattern asks for a roving tabindex so Tab
            skips the list into the panel; with exactly two tabs that buys
            nothing and costs a rule to remember.

            Deliberately not disabled while restarting, unlike the fields and
            buttons: those are disabled because an edit made on the way down
            would be lost, and changing tab loses nothing. */}
        <div className="modal__tabs" role="tablist" aria-label={t().setup.tabsLabel}>
          {tabs.map(({ id, label, ref }) => (
            <button
              key={id}
              ref={ref}
              type="button"
              role="tab"
              id={`setup-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`setup-panel-${id}`}
              className={`modal__tab${tab === id ? ' modal__tab--active' : ''}`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                const other = id === 'stores' ? tabs[1]! : tabs[0]!
                setTab(other.id)
                other.ref.current?.focus()
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'stores' ? (
          <div role="tabpanel" id="setup-panel-stores" aria-labelledby="setup-tab-stores">
            <StoreSelection enabled={enabledStores} onChange={onEnabledStoresChange} />
            <p className="modal__sublabel">{t().setup.storesApplyAtOnce}</p>
          </div>
        ) : (
          <div role="tabpanel" id="setup-panel-keys" aria-labelledby="setup-tab-keys">
            <ApiKeyFields
              values={edited}
              onChange={setEdited}
              skip={skip}
              onSkipChange={setSkip}
              restarting={restarting}
              path={path}
              firstFieldRef={first}
            />
          </div>
        )}

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
