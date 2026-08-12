import { describe, expect, it } from 'vitest'
import { createAdapters } from '@main/stores'
import { STORE_IDS } from '@shared/types'

describe('createAdapters', () => {
  it('creates exactly one adapter per store', () => {
    // Grows with STORE_IDS: if a store is added without an adapter, this
    // test fails rather than silently swallowing the store. 'other' is the
    // exception — it identifies hand-added games rather than a store an
    // adapter scans, so it never gets one.
    const adaptedStoreIds = STORE_IDS.filter((id) => id !== 'other')
    const adapters = createAdapters({ steam: {} })
    expect(adapters.map((a) => a.id).sort()).toEqual([...adaptedStoreIds].sort())
  })

  it('gives every adapter a user-visible name', () => {
    for (const adapter of createAdapters({ steam: {} })) {
      expect(adapter.displayName.length, `${adapter.id} has no display name`).toBeGreaterThan(0)
    }
  })

  it('provides a launch URI for every adapter', () => {
    for (const adapter of createAdapters({ steam: {} })) {
      expect(typeof adapter.launchUri, `${adapter.id} has no launchUri`).toBe('function')
    }
  })

  it('makes every adapter reject an illegal game ID', () => {
    // The ID travels into a URI that goes to the operating system. No store
    // may pass it through unchecked.
    for (const adapter of createAdapters({ steam: {} })) {
      const hostile = {
        id: `${adapter.id}:x`,
        storeId: adapter.id,
        storeGameId: '../../hostile',
        name: 'X',
        installed: true,
        favorite: false,
        hidden: false,
        firstSeen: 0,
        lastSeen: 0
      }
      expect(() => adapter.launchUri(hostile), `${adapter.id} does not check the ID`).toThrow()
    }
  })
})
