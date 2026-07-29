import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_LANGUAGE,
  getLanguage,
  parseLanguage,
  setLanguage,
  t
} from '@shared/i18n'

afterEach(() => {
  setLanguage(DEFAULT_LANGUAGE)
})

describe('parseLanguage', () => {
  it('accepts the supported languages', () => {
    expect(parseLanguage('en')).toBe('en')
    expect(parseLanguage('de')).toBe('de')
  })

  it('rejects anything else', () => {
    // The value comes out of the settings table, which a user can edit and
    // an older version could have written. An unknown value must fall back
    // to the default rather than reaching `BUNDLES[value]` and yielding
    // undefined for every string in the interface.
    for (const bad of ['fr', '', 'EN', 'de-DE', null, undefined, 7, {}]) {
      expect(parseLanguage(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })
})

describe('setLanguage', () => {
  it('changes what t() returns', () => {
    setLanguage('de')
    expect(getLanguage()).toBe('de')
    expect(t().toolbar.refresh).toBe('Aktualisieren')

    setLanguage('en')
    expect(t().toolbar.refresh).toBe('Refresh')
  })

  it('changes the collator locale', () => {
    // sortGames takes its collator from t().format.locale. An English
    // collator puts "Ärger" after "Zorn", which reads as a sorting bug to a
    // German speaker — so the language has to reach this too, not just the
    // button captions.
    setLanguage('de')
    expect(t().format.locale).toBe('de-DE')
    setLanguage('en')
    expect(t().format.locale).toBe('en-GB')
  })
})
