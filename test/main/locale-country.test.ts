/**
 * The store country derived from Electron's system locale.
 *
 * Regressions here feed straight into Steam's `cc=` and Epic's `country=`
 * query parameters, so a wrong answer does not throw — it quietly asks a
 * third-party feed for the wrong region's promotions.
 */
import { describe, expect, it } from 'vitest'
import { countryFromLocale } from '@main/locale-country'

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

  it('uses a bare two-letter language tag as its own best guess', () => {
    // No region segment exists at all here, so there is nothing to prefer
    // over the primary subtag itself — and defaulting a German system
    // straight to US, which the old split-based code did, was exactly the
    // kind of silently-wrong answer this fix replaces.
    expect(countryFromLocale('de')).toBe('DE')
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
