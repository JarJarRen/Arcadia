import { useCallback, useRef, useState, type ReactElement } from 'react'
import { LANGUAGES, t, type Language } from '@shared/i18n'
import { useLanguage } from '../i18n/LanguageProvider'
import { useDismiss } from '../hooks/useDismiss'

/**
 * The gear menu holding the language choice.
 *
 * A popover rather than another select in the filter row: the language is
 * set once and then forgotten, while everything else in the toolbar is
 * changed constantly. Mixing them would grow the row to nine controls and
 * bury the filters.
 */
export function LanguageMenu(): ReactElement {
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
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        ⚙
      </button>

      {open && (
        <div className="popover__panel popover__panel--end" role="menu">
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
