/**
 * The freebies cache and the claim record.
 *
 * The two tables have deliberately different lifetimes: the cache is
 * rewritten on every refresh, the claims survive it. Testing them together
 * is what pins that difference down.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { FreebieRepository } from '@main/db/freebies'
import type { RawFreebie } from '@shared/freebies'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

const ghost: RawFreebie = {
  storeId: 'epic',
  title: 'Ghostrunner',
  kind: 'game',
  storeGameId: 'ghostrunner',
  imageUrl: 'https://cdn1.epicgames.com/wide.jpg',
  startsAt: NOW - 1000,
  endsAt: NOW + 86_400_000,
  source: 'epic'
}

const skin: RawFreebie = {
  storeId: 'ubisoft',
  title: 'Skin Pack',
  kind: 'dlc',
  claimUrl: 'https://www.gamerpower.com/open/skin',
  source: 'gamerpower'
}

describe('FreebieRepository', () => {
  let db: DatabaseSync
  let repo: FreebieRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new FreebieRepository(db)
  })

  it('reads back everything it wrote', () => {
    repo.replaceAll([ghost, skin], NOW)
    const rows = repo.list()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.title === 'Ghostrunner')).toEqual({
      id: 'epic:ghostrunner',
      storeId: 'epic',
      title: 'Ghostrunner',
      kind: 'game',
      storeGameId: 'ghostrunner',
      imageUrl: 'https://cdn1.epicgames.com/wide.jpg',
      startsAt: NOW - 1000,
      endsAt: NOW + 86_400_000,
      source: 'epic',
      claim: 'unclaimed'
    })
  })

  it('drops a promotion that the next refresh no longer reports', () => {
    repo.replaceAll([ghost, skin], NOW)
    repo.replaceAll([ghost], NOW + 1000)
    expect(repo.list().map((row) => row.title)).toEqual(['Ghostrunner'])
  })

  it('keeps a claim alive after its promotion has gone', () => {
    repo.replaceAll([ghost], NOW)
    repo.markOpened('epic:ghostrunner', NOW)
    repo.markConfirmed('epic:ghostrunner', NOW + 5000)
    repo.replaceAll([skin], NOW + 10_000)

    // The freebies row is gone; the claim is not.
    expect(repo.list().map((row) => row.title)).toEqual(['Skin Pack'])
    repo.replaceAll([ghost, skin], NOW + 20_000)
    expect(repo.find('epic:ghostrunner')?.claim).toBe('confirmed')
  })

  it('reports a freshly opened claim as pending, with the time', () => {
    repo.replaceAll([ghost], NOW)
    repo.markOpened('epic:ghostrunner', NOW)
    const row = repo.find('epic:ghostrunner')
    expect(row?.claim).toBe('pending')
    expect(row?.openedAt).toBe(NOW)
  })

  it('overwrites the opened time when the button is pressed again', () => {
    repo.replaceAll([ghost], NOW)
    repo.markOpened('epic:ghostrunner', NOW)
    repo.markOpened('epic:ghostrunner', NOW + 60_000)
    expect(repo.find('epic:ghostrunner')?.openedAt).toBe(NOW + 60_000)
  })

  it('lists only the claims still waiting for confirmation', () => {
    repo.replaceAll([ghost, skin], NOW)
    repo.markOpened('epic:ghostrunner', NOW)
    repo.markOpened('ubisoft:skin pack', NOW)
    repo.markConfirmed('ubisoft:skin pack', NOW + 1000)

    expect(repo.pendingClaims()).toEqual([
      { id: 'epic:ghostrunner', storeId: 'epic', title: 'Ghostrunner', storeGameId: 'ghostrunner' }
    ])
  })

  it('rolls back a failed refresh and leaves the previous cache intact', () => {
    repo.replaceAll([ghost], NOW)
    // kind is NOT NULL in the schema; casting past the type system is the
    // only way to make a row that node:sqlite will actually reject.
    const broken = { ...skin, kind: undefined } as unknown as RawFreebie
    expect(() => repo.replaceAll([broken], NOW + 1000)).toThrow()
    expect(repo.list().map((row) => row.title)).toEqual(['Ghostrunner'])
  })

  it('omits storeGameId from a pending claim whose freebie has none', () => {
    repo.replaceAll([skin], NOW)
    repo.markOpened('ubisoft:skin pack', NOW)

    expect(repo.pendingClaims()).toEqual([
      { id: 'ubisoft:skin pack', storeId: 'ubisoft', title: 'Skin Pack' }
    ])
  })

  it('answers with nothing for an id that was never stored', () => {
    expect(repo.find('steam:nothing')).toBeUndefined()
  })

  it('prunes claims older than the cutoff and keeps newer ones', () => {
    repo.replaceAll([ghost, skin], NOW)
    repo.markOpened('epic:ghostrunner', NOW - 400 * 86_400_000)
    repo.markOpened('ubisoft:skin pack', NOW - 30 * 86_400_000)
    repo.pruneClaims(NOW - 365 * 86_400_000)

    expect(repo.find('epic:ghostrunner')?.claim).toBe('unclaimed')
    expect(repo.find('ubisoft:skin pack')?.claim).toBe('pending')
  })
})
