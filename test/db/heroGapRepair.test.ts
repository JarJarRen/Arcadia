import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase, repairHeroGaps, runOnce } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import type { GameMetadata } from '@shared/metadata'

/**
 * Lets the games already in the database pick up the header URL.
 *
 * The queue now prefers the header the store reports, because the derived
 * one is a 404 for every title on Steam's hashed asset path. That only helps
 * a game whose metadata is still to be fetched — and `pendingGameIds`
 * requires `fetched_at IS NULL`, so a game fetched before the fix would keep
 * its empty details page for good. Measured on a real library: three games,
 * all of them fetched weeks ago.
 */

const T0 = 1_700_000_000

const meta = (o: Partial<GameMetadata> = {}): GameMetadata => ({
  developers: [],
  publishers: [],
  genres: [],
  screenshots: [],
  fetchAttempts: 0,
  fetchedAt: T0,
  ...o
})

describe('the repair for missing heroes', () => {
  let db: DatabaseSync
  let games: GameRepository
  let metadata: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    metadata = new MetadataRepository(db)
    games.upsertScan(
      'steam',
      [
        { storeGameId: '3949040', name: 'RV There Yet?', installed: true },
        { storeGameId: '440', name: 'Team Fortress 2', installed: true }
      ],
      T0
    )
  })

  const pending = () => metadata.pendingGameIds(10, 'en')

  it('makes a game with no hero pending again', async () => {
    metadata.upsert('steam:3949040', meta({ steamAppId: 3949040 }), 'en')
    // The grid arrived from SteamGridDB; only the hero is missing.
    metadata.upsertArtwork('steam:3949040', [
      { kind: 'grid', url: 'https://cdn2.steamgriddb.com/grid/abc.png' }
    ])
    expect(pending()).not.toContain('steam:3949040')

    repairHeroGaps(db)

    expect(pending()).toContain('steam:3949040')
  })

  it('leaves a game that has a hero alone', async () => {
    metadata.upsert('steam:440', meta({ steamAppId: 440 }), 'en')
    metadata.upsertArtwork('steam:440', [
      {
        kind: 'hero',
        url: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/440/header.jpg'
      }
    ])

    repairHeroGaps(db)

    expect(pending()).not.toContain('steam:440')
  })

  it('leaves a game with no AppID alone', async () => {
    // Nothing to re-fetch: without an AppID there is no store entry that
    // could report a header, and the pass would only burn an attempt.
    metadata.upsert('steam:440', meta(), 'en')

    repairHeroGaps(db)

    expect(pending()).not.toContain('steam:440')
  })

  it('keeps the text that was already fetched', async () => {
    // The point is a second look at the artwork, not throwing away a
    // description that took a request to get.
    metadata.upsert('steam:3949040', meta({ steamAppId: 3949040, shortDescription: 'A co-op road trip.' }), 'en')

    repairHeroGaps(db)

    expect(metadata.get('steam:3949040', 'en')?.shortDescription).toBe('A co-op road trip.')
  })

  it('does not reopen the same game a second time', () => {
    // The condition stays true for a game Steam reports no header for: it
    // gets fetched, gains no hero, and looks exactly like a gap again. Left
    // unbounded, the repair would re-fetch it on every start of the app
    // forever.
    metadata.upsert('steam:3949040', meta({ steamAppId: 3949040 }), 'en')
    runOnce(db, 'repair:hero-gaps', repairHeroGaps)
    expect(pending()).toContain('steam:3949040')

    // What the pass does next: fetches, finds no header, records the fetch.
    metadata.upsert('steam:3949040', meta({ steamAppId: 3949040 }), 'en')
    runOnce(db, 'repair:hero-gaps', repairHeroGaps)

    expect(pending()).not.toContain('steam:3949040')
  })

  it('is not recorded as done when there was nothing to repair', () => {
    // A fresh installation has no gaps, and marking the repair done there
    // would spend it before the games it exists for ever arrive — the
    // library is scanned after the database is opened.
    let repairs = 0
    const nothingToDo = () => {
      repairs++
      return 0
    }

    runOnce(db, 'repair:example', nothingToDo)
    runOnce(db, 'repair:example', nothingToDo)

    expect(repairs).toBe(2)
  })
})
