/**
 * The enabled-store setting.
 *
 * Three states, and the difference between two of them is the whole point:
 * an absent row means every store — what every existing installation has —
 * while an empty string means none, which is a choice the user is allowed to
 * make. Collapsing the second into the first would make "no stores" unusable.
 */
import { describe, expect, it } from 'vitest'
import { parseEnabledStores, serializeEnabledStores } from '@shared/stores'
import { STORE_IDS } from '@shared/types'

describe('parseEnabledStores', () => {
  it('treats an absent row as every store', () => {
    expect(parseEnabledStores(undefined)).toEqual([...STORE_IDS])
  })

  it('treats an empty value as no store at all', () => {
    expect(parseEnabledStores('')).toEqual([])
  })

  it('reads a stored selection', () => {
    expect(parseEnabledStores('steam,epic')).toEqual(['steam', 'epic'])
  })

  it('returns the selection in STORE_IDS order, not the stored order', () => {
    expect(parseEnabledStores('epic,steam')).toEqual(['steam', 'epic'])
  })

  it('drops ids it does not recognise', () => {
    // A store removed in a later version, read back by an older one. The
    // setting stays usable rather than being rejected whole.
    expect(parseEnabledStores('steam,gog')).toEqual(['steam'])
  })

  it('tolerates whitespace around the separators', () => {
    expect(parseEnabledStores('steam, epic')).toEqual(['steam', 'epic'])
  })
})

describe('serializeEnabledStores', () => {
  it('round-trips a selection', () => {
    expect(parseEnabledStores(serializeEnabledStores(['epic', 'steam']))).toEqual([
      'steam',
      'epic'
    ])
  })

  it('writes an empty string for no stores', () => {
    expect(serializeEnabledStores([])).toBe('')
  })
})
