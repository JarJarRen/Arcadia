import { useEffect, useRef, useState, type ReactElement } from 'react'
import { LANGUAGES, t, type Language } from '@shared/i18n'
import { useLanguage } from '../i18n/LanguageProvider'

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

  // Close on an outside click or Escape. Without this the popover stays open
  // behind the next click, over the tiles.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="settingsmenu" ref={root}>
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
        <div className="settingsmenu__popover" role="menu">
          <p className="settingsmenu__label">{t().toolbar.languageLabel}</p>
          {LANGUAGES.map((code: Language) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={language === code}
              className={`settingsmenu__item${
                language === code ? ' settingsmenu__item--active' : ''
              }`}
              onClick={() => {
                change(code)
                setOpen(false)
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
