/**
 * Branches of the queue that queue.test.ts does not reach:
 *
 *  - a prior manual match (set via `applyManualMatch`) beats automatic name
 *    matching on every later pass of `runMetadataPass`, rather than being
 *    overwritten by it;
 *  - an AppID that is found (Steam ID, or a carried-over manual match) but
 *    whose fetch resolves to *no data* — not a thrown error — still counts
 *    as a failed attempt, distinct from the "name not found" case where
 *    there was never an AppID to fetch;
 *  - `applyManualMatch` itself. The brief for this task named two narrow
 *    line ranges inside `runMetadataPass` as the only gap in queue.ts. A
 *    coverage run against the whole suite shows the true gap is wider:
 *    `applyManualMatch` (the function `IPC.metadataSetMatch` calls) is never
 *    invoked by any existing test — every existing reference to
 *    `IPC.metadataSetMatch` feeds it invalid arguments that are rejected
 *    before the handler reaches it. So its body is covered here directly.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { applyManualMatch, runMetadataPass, type MetadataDeps } from '@main/metadata/queue'
import { STEAM_ASSET_BASE } from '@shared/metadata'

const T0 = 1_700_000_000

describe('runMetadataPass — manual match and empty fetches', () => {
  let db: DatabaseSync
  let games: GameRepository
  let metaRepo: MetadataRepository

  const baseDeps = (): MetadataDeps => ({
    findAppId: () => undefined,
    fetchDetails: async () => undefined,
    epicArtwork: new Map(),
    pause: async () => undefined,
    now: () => T0
  })

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    metaRepo = new MetadataRepository(db)
  })

  it('keeps a prior manual match rather than letting an automatic pass overwrite it', async () => {
    games.upsertScan(
      'ubisoft',
      [{ storeGameId: '856', name: 'Far Cry 4', installed: true }],
      T0
    )
    // As applyManualMatch would have recorded it: hand-picked AppID 298110,
    // never fetched yet, so the game is still pending.
    metaRepo.setManualMatch('ubisoft:856', 298110)

    let nameMatchAttempted = false
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      findAppId: () => {
        nameMatchAttempted = true
        // A wrong AppID: if this were used, the assertion below would
        // catch it.
        return 1
      },
      fetchDetails: async (id) => ({
        developers: [],
        publishers: [],
        genres: [],
        screenshots: [],
        shortDescription: '',
        fetchAttempts: 0,
        steamAppId: id
      })
    })

    // The manual match must never reach automatic name matching at all.
    expect(nameMatchAttempted).toBe(false)
    const stored = metaRepo.get('ubisoft:856', 'en')!
    expect(stored.steamAppId).toBe(298110)
    expect(stored.matchSource).toBe('manual')
  })

  it('counts a fetch that resolves to no data as a failed attempt, not an unmatched name', async () => {
    // Distinct from "findAppId returns undefined" (queue.test.ts): here the
    // AppID is known (the Steam storeGameId itself) but the store has
    // nothing for it — a delisted game, for instance.
    games.upsertScan(
      'steam',
      [{ storeGameId: '999999999', name: 'Delisted Game', installed: true }],
      T0
    )
    const result = await runMetadataPass(games, metaRepo, baseDeps())

    expect(result.considered).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.succeeded).toBe(0)
    const stored = metaRepo.get('steam:999999999', 'en')
    expect(stored?.fetchAttempts).toBe(1)
    expect(stored?.fetchedAt).toBeUndefined()
  })
})

describe('applyManualMatch', () => {
  let db: DatabaseSync
  let games: GameRepository
  let metaRepo: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    metaRepo = new MetadataRepository(db)
    // metadata.game_id is a foreign key into games — a manual match always
    // corrects an existing library entry.
    games.upsertScan(
      'ubisoft',
      [
        { storeGameId: '1', name: 'Far Cry 4', installed: true },
        { storeGameId: '2', name: 'Broken', installed: true },
        { storeGameId: '3', name: 'Also Broken', installed: true },
        { storeGameId: '4', name: 'Had Old Art', installed: true }
      ],
      T0
    )
  })

  it('records the match and fetches it straight away, succeeding', async () => {
    const ok = await applyManualMatch(metaRepo, 'ubisoft:1', 298110, {
      fetchDetails: async (id) => ({
        developers: ['Ubisoft'],
        publishers: ['Ubisoft'],
        genres: ['Action'],
        screenshots: [],
        shortDescription: 'Far Cry 4',
        fetchAttempts: 0,
        steamAppId: id
      }),
      now: () => T0,
      // No real Steam-CDN network check here — that path belongs to
      // verifiedSteamArtwork and is exercised via runMetadataPass in
      // queue.test.ts. This deterministically declines every image.
      imageExists: async () => false
    })

    expect(ok).toBe(true)
    const stored = metaRepo.get('ubisoft:1', 'en')!
    expect(stored.steamAppId).toBe(298110)
    expect(stored.matchSource).toBe('manual')
    expect(stored.shortDescription).toBe('Far Cry 4')
    expect(stored.fetchedAt).toBe(T0)
  })

  it('still records the match when the fetch finds no data, and returns false', async () => {
    // The correction is the user's decision, not the result of a fetch —
    // it must stand even when the fetch that follows does not.
    const ok = await applyManualMatch(metaRepo, 'ubisoft:2', 999, {
      fetchDetails: async () => undefined,
      now: () => T0
    })

    expect(ok).toBe(false)
    const stored = metaRepo.get('ubisoft:2', 'en')!
    expect(stored.steamAppId).toBe(999)
    expect(stored.matchSource).toBe('manual')
    expect(stored.fetchAttempts).toBe(1)
    expect(stored.fetchedAt).toBeUndefined()
  })

  it('still records the match when the fetch throws, and returns false', async () => {
    const ok = await applyManualMatch(metaRepo, 'ubisoft:3', 111, {
      fetchDetails: async () => {
        throw new Error('network down')
      },
      now: () => T0
    })

    expect(ok).toBe(false)
    const stored = metaRepo.get('ubisoft:3', 'en')!
    expect(stored.steamAppId).toBe(111)
    expect(stored.matchSource).toBe('manual')
    expect(stored.fetchAttempts).toBe(1)
  })

  it('clears the previous Steam artwork but keeps non-Steam artwork', async () => {
    // Steam's image URLs are derived from the AppID and belong to the
    // previous game; the queue only fills in missing kinds and would
    // otherwise leave the wrong picture in place. Epic's images come from
    // the local catalogue and stay correct regardless of the Steam match.
    metaRepo.upsertArtwork('ubisoft:4', [
      { kind: 'grid', url: `${STEAM_ASSET_BASE}/9999/library_600x900.jpg` },
      { kind: 'hero', url: 'https://cdn1.epicgames.com/old-hero.jpg' }
    ])

    await applyManualMatch(metaRepo, 'ubisoft:4', 222, {
      fetchDetails: async () => undefined,
      now: () => T0
    })

    const remaining = metaRepo.artworkFor('ubisoft:4')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.url).toBe('https://cdn1.epicgames.com/old-hero.jpg')
  })
})
