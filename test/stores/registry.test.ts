import { describe, expect, it } from 'vitest'
import { createAdapters, type OtherAdapterDeps } from '@main/stores'
import { STORE_IDS } from '@shared/types'

// A minimal stand-in for the storeless adapter's dependencies: an empty
// library and a file check that is never exercised by these tests.
const otherDeps: OtherAdapterDeps = { listStoreless: () => [], fileExists: () => false }

describe('createAdapters', () => {
  it('creates exactly one adapter per store', () => {
    // Grows with STORE_IDS: if a store is added without an adapter, this
    // test fails rather than silently swallowing the store.
    const adapters = createAdapters({ steam: {}, other: otherDeps })
    expect(adapters.map((a) => a.id).sort()).toEqual([...STORE_IDS].sort())
  })

  it('gives every adapter a user-visible name', () => {
    for (const adapter of createAdapters({ steam: {}, other: otherDeps })) {
      expect(adapter.displayName.length, `${adapter.id} has no display name`).toBeGreaterThan(0)
    }
  })

  it('provides a launch URI for every adapter', () => {
    for (const adapter of createAdapters({ steam: {}, other: otherDeps })) {
      expect(typeof adapter.launchUri, `${adapter.id} has no launchUri`).toBe('function')
    }
  })

  it('makes every adapter reject an illegal game ID', () => {
    // The ID travels into a URI that goes to the operating system. No store
    // may pass it through unchecked.
    for (const adapter of createAdapters({ steam: {}, other: otherDeps })) {
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
