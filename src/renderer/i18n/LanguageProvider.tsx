import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  DEFAULT_LANGUAGE,
  getLanguage,
  parseLanguage,
  setLanguage,
  type Language
} from '@shared/i18n'

interface LanguageContextValue {
  language: Language
  change: (language: Language) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  change: () => undefined
})

/**
 * Makes the language switch visible.
 *
 * `t()` reads a module-level variable, so calling `setLanguage()` on its own
 * changes nothing on screen: React has no reason to re-render. The context
 * supplies that reason.
 *
 * The module-level setter is still called, and first — everything outside
 * React depends on it: `sortGames` takes its collator from
 * `t().format.locale`, and `formatPlaytime` its unit strings. Setting only
 * React state would leave the tiles translated and the sorting German.
 */
export function LanguageProvider({ children }: { children: ReactNode }): ReactElement {
  const [language, setState] = useState<Language>(getLanguage())

  useEffect(() => {
    // Main and renderer are separate processes, each holding its own copy
    // of the i18n module's current language. `useState` above only ever
    // reads this process's copy, which starts at DEFAULT_LANGUAGE no matter
    // what was chosen last time — so without this fetch, a persisted German
    // setting left the renderer silently stuck in English while main's own
    // messages spoke German. `window.arcadia.getLanguage` answers with
    // main's already-applied value, i.e. the persisted one.
    let cancelled = false

    void window.arcadia.getLanguage().then((value) => {
      // The component may have unmounted while the round trip was in
      // flight; setting state on it then would be a no-op React warns about.
      if (cancelled) return
      const persisted = parseLanguage(value)
      if (persisted === undefined) return
      // Same order as `change` below, and for the same reason: t() is read
      // during render, so the module has to switch before the state does.
      setLanguage(persisted)
      setState(persisted)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const change = useCallback((next: Language): void => {
    // Module first, state second: the re-render triggered by setState reads
    // t() while rendering, and would still see the old bundle otherwise.
    setLanguage(next)
    setState(next)
    // The main process keeps its own copy of the module — it is a separate
    // process. It also persists the choice and re-sends the library, whose
    // metadata is per language.
    void window.arcadia.setLanguage(next)
  }, [])

  return (
    <LanguageContext.Provider value={{ language, change }}>{children}</LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}
