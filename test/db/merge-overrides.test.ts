import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import type { RawGame } from '@shared/types'

const T0 = 1_700_000_000
const raw = (storeGameId: string, name: string): RawGame => ({
  storeGameId,
  name,
  installed: true
})

describe('merge_overrides', () => {
  let db: DatabaseSync
  let repo: GameRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new GameRepository(db)
  })

  it('returns empty defaults when nothing has been stored', () => {
    const overrides = repo.readMergeOverrides()
    expect(overrides.preferred).toEqual({})
    expect(overrides.split.size).toBe(0)
  })

  it('remembers the preferred store', () => {
    repo.setPreferredStore('far cry 4', 'ubisoft:856')
    expect(repo.readMergeOverrides().preferred['far cry 4']).toBe('ubisoft:856')
  })

  it('lets the choice be cleared again', () => {
    repo.setPreferredStore('far cry 4', 'ubisoft:856')
    repo.setPreferredStore('far cry 4', undefined)
    expect(repo.readMergeOverrides().preferred['far cry 4']).toBeUndefined()
  })

  it('remembers a split', () => {
    repo.setSplit('same name', true)
    expect(repo.readMergeOverrides().split.has('same name')).toBe(true)
  })

  it('lets a split be undone again', () => {
    repo.setSplit('same name', true)
    repo.setSplit('same name', false)
    expect(repo.readMergeOverrides().split.has('same name')).toBe(false)
  })

  it('keeps store choice and split apart for the same key', () => {
    // Both share one row; setting one must not wipe the other.
    repo.setPreferredStore('x', 'steam:1')
    repo.setSplit('x', true)
    const after = repo.readMergeOverrides()
    expect(after.preferred['x']).toBe('steam:1')
    expect(after.split.has('x')).toBe(true)
  })

  it('survives a rescan of the library', () => {
    // The choice hangs off the merge key, not off a game row — so a scan
    // must not touch it.
    repo.upsertScan('steam', [raw('440', 'TF2')], T0)
    repo.setPreferredStore('tf2', 'steam:440')
    repo.upsertScan('steam', [raw('440', 'TF2')], T0 + 1)
    expect(repo.readMergeOverrides().preferred['tf2']).toBe('steam:440')
  })

  it('clears a row holding neither a choice nor a split', () => {
    // Otherwise empty rows would accumulate over time.
    repo.setPreferredStore('x', 'steam:1')
    repo.setPreferredStore('x', undefined)
    const rows = db.prepare('SELECT COUNT(*) c FROM merge_overrides').get() as { c: number }
    expect(rows.c).toBe(0)
  })
})
