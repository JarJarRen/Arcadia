import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { DEFAULT_LANGUAGE, getLanguage, setLanguage, type Language } from '@shared/i18n'

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
