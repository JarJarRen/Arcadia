/**
 * Which adapters a scan is given.
 *
 * Filtering before `runSync` rather than inside `scanOne` is deliberate: a
 * store that was switched off produces no StoreScanResult at all, so it
 * cannot report a failure for something the user has already opted out of.
 */
import { describe, expect, it } from 'vitest'
import { enabledAdapters } from '@main/stores/enabled'
import type { StoreAdapter } from '@main/stores/types'
import type { StoreId } from '@shared/types'

function stub(id: StoreId): StoreAdapter {
  return {
    id,
    displayName: id,
    isAvailable: async () => ({ available: true }),
    scanInstalled: async () => [],
    launchUri: () => '',
    installUri: () => ''
  }
}

const all = [stub('steam'), stub('epic'), stub('ea'), stub('ubisoft')]

describe('enabledAdapters', () => {
  it('passes every adapter through when nothing has been chosen', () => {
    expect(enabledAdapters(all, undefined).map((a) => a.id)).toEqual([
      'steam',
      'epic',
      'ea',
      'ubisoft'
    ])
  })

  it('keeps only the stores the setting names', () => {
    expect(enabledAdapters(all, 'steam,ea').map((a) => a.id)).toEqual(['steam', 'ea'])
  })

  it('passes nothing through for an empty selection', () => {
    expect(enabledAdapters(all, '')).toEqual([])
  })

  it('ignores an enabled store that has no adapter', () => {
    expect(enabledAdapters([stub('steam')], 'steam,epic').map((a) => a.id)).toEqual(['steam'])
  })
})
