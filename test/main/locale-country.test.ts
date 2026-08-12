/**
 * The store country derived from Electron's system locale.
 *
 * Regressions here feed straight into Steam's `cc=` and Epic's `country=`
 * query parameters, so a wrong answer does not throw — it quietly asks a
 * third-party feed for the wrong region's promotions.
 */
import { describe, expect, it } from 'vitest'
import { countryFromLocale, resolveStoreCountry } from '@main/locale-country'

describe('countryFromLocale', () => {
  it('reads the region from a plain language-region tag', () => {
    expect(countryFromLocale('de-DE')).toBe('DE')
  })

  it('reads the region from a language-script-region tag, not the script', () => {
    expect(countryFromLocale('zh-Hans-CN')).toBe('CN')
  })

  it('falls back to US for a UN numeric area code, not "419"', () => {
    expect(countryFromLocale('es-419')).toBe('US')
  })

  it('refuses to read a bare language tag as a country', () => {
    // Language codes and country codes are separate namespaces that agree
    // only by luck. "de" would land on Germany, which is why reusing the
    // subtag looks reasonable — but "sv" is Swedish and El Salvador, "et"
    // is Estonian and Ethiopia, "ca" is Catalan and Canada. Guessing asks
    // the store for a real but wrong region, which is worse than asking for
    // the default and much harder to spot.
    expect(countryFromLocale('de')).toBe('US')
    expect(countryFromLocale('sv')).toBe('US')
    expect(countryFromLocale('et')).toBe('US')
  })

  it('falls back to US when the last segment is not a two-letter code at all', () => {
    // A script subtag with no region after it — unlike zh-Hans-CN above,
    // which does have one.
    expect(countryFromLocale('zh-Hans')).toBe('US')
  })

  it('uppercases a lowercase region', () => {
    expect(countryFromLocale('en-us')).toBe('US')
  })
})

describe('resolveStoreCountry', () => {
  it('trusts a valid OS country code over the locale', () => {
    // The OS code is the real answer; the locale is only ever a guess.
    expect(resolveStoreCountry('DE', 'en-US')).toBe('DE')
  })

  it('falls through to the locale when the OS reports no country', () => {
    // app.getLocaleCountryCode() returns "" on some Linux desktops.
    expect(resolveStoreCountry('', 'de-DE')).toBe('DE')
  })

  it('falls back to US when neither the OS nor the locale has a usable country', () => {
    expect(resolveStoreCountry('', 'de')).toBe('US')
  })

  it('uppercases a lowercase OS country code', () => {
    expect(resolveStoreCountry('de', 'en-US')).toBe('DE')
  })
})
