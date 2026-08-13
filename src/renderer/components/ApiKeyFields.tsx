import { type ReactElement, type RefObject } from 'react'
import { t } from '@shared/i18n'
import type { EnvConfigKey, EnvConfigValues } from '@shared/env-config'

interface Props {
  values: EnvConfigValues
  onChange: (values: EnvConfigValues) => void
  skip: boolean
  onSkipChange: (skip: boolean) => void
  /** Disables every control while the app is on its way down. */
  restarting: boolean
  /** The `.env` that will be written, shown so the user knows which file. */
  path: string
  /**
   * Attached to the first field.
   *
   * Held by `SetupDialog` rather than here, because it is the component that
   * knows when this panel becomes visible and therefore when to focus it.
   */
  firstFieldRef: RefObject<HTMLInputElement | null>
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
 * The three API keys, the skip answer, and which file they are written to.
 *
 * Its own component for the same reason `StoreSelection` is: the dialog is
 * the shell that arranges the parts, and each part is about one thing. It
 * holds no state — `SetupDialog` owns the values because `submit()` is what
 * sends them.
 */
export function ApiKeyFields({
  values,
  onChange,
  skip,
  onSkipChange,
  restarting,
  path,
  firstFieldRef
}: Props): ReactElement {
  return (
    <>
      {fields().map((field, index) => (
        <label className="modal__field" key={field.key}>
          <span className="modal__label">{field.label}</span>
          <input
            ref={index === 0 ? firstFieldRef : undefined}
            className="modal__search"
            value={values[field.key]}
            disabled={skip || restarting}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
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

      <label className="modal__toggle modal__toggle--skip">
        <input
          type="checkbox"
          checked={skip}
          disabled={restarting}
          onChange={(event) => onSkipChange(event.target.checked)}
        />
        <span>
          {t().setup.skip}
          <span className="modal__sublabel">{t().setup.skipHint}</span>
        </span>
      </label>

      <p className="modal__sublabel">{t().setup.fileHint(path)}</p>
    </>
  )
}
