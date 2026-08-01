import { useCallback, useRef, useState, type ReactElement } from 'react'
import { LANGUAGES, t, type Language } from '@shared/i18n'
import { useLanguage } from '../i18n/LanguageProvider'
import { useDismiss } from '../hooks/useDismiss'

interface Props {
  /** Reopens the configuration screen the first start showed. */
  onOpenSetup: () => void
}

/**
 * The gear menu: the configuration screen and the language choice.
 *
 * A popover rather than more controls in the filter row: both are set once
 * and then forgotten, while everything else in the toolbar is changed
 * constantly. Mixing them would bury the filters.
 *
 * It was called LanguageMenu while the language was all it held. The
 * configuration entry is what the name was always going to have to cover —
 * the CSS beneath it stopped being gear-specific one change earlier.
 */
export function SettingsMenu({ onOpenSetup }: Props): ReactElement {
  const { language, change } = useLanguage()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useDismiss(open, root, close)

  return (
    <div className="popover" ref={root}>
      <button
        type="button"
        className="button button--icon"
        aria-label={t().toolbar.settingsLabel}
        title={t().toolbar.settingsLabel}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        ⚙
      </button>

      {open && (
        <div className="popover__panel popover__panel--end" role="menu">
          <button
            type="button"
            role="menuitem"
            className="popover__item"
            onClick={() => {
              onOpenSetup()
              close()
            }}
          >
            {t().setup.title}…
          </button>

          <p className="popover__label">{t().toolbar.languageLabel}</p>
          {LANGUAGES.map((code: Language) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={language === code}
              className={`popover__item${language === code ? ' popover__item--active' : ''}`}
              onClick={() => {
                change(code)
                close()
              }}
            >
              {t().toolbar.language[code]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
