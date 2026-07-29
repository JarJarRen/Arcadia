import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { SettingsRepository } from '@main/db/settings'

describe('SettingsRepository', () => {
  let db: DatabaseSync
  let settings: SettingsRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    settings = new SettingsRepository(db)
  })

  it('reads back what it wrote', () => {
    settings.set('language', 'de')
    expect(settings.get('language')).toBe('de')
  })

  it('returns undefined for a key that was never set', () => {
    // Distinguishable from a stored empty string — the caller has to be able
    // to tell "never chosen" from "deliberately blank" to fall back to the
    // default language.
    expect(settings.get('language')).toBeUndefined()
    settings.set('language', '')
    expect(settings.get('language')).toBe('')
  })

  it('overwrites rather than accumulating rows', () => {
    settings.set('language', 'de')
    settings.set('language', 'en')
    expect(settings.get('language')).toBe('en')

    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?')
      .get('language') as unknown as { n: number }
    expect(rows.n).toBe(1)
  })

  it('keeps different keys apart', () => {
    settings.set('language', 'de')
    settings.set('viewMode', 'list')
    expect(settings.get('language')).toBe('de')
    expect(settings.get('viewMode')).toBe('list')
  })
})
