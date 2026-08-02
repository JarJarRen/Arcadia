/**
 * The background metadata service.
 *
 * Not tested for what it fetches — the individual fetchers have their own
 * tests (queue.test.ts, artworkQueue.test.ts) — but for the loop around
 * them: that it stops when nothing is left open, that a rate-limit block
 * pauses rather than gives up, and that a missing SteamGridDB key means
 * fewer images rather than an error.
 *
 * The sleeps between passes (`BATCH_PAUSE_MS`, `RATE_LIMIT_PAUSE_MS`) are
 * real timers in production. Fake ones here, or the suite would sit for a
 * minute on the rate-limit case alone.
 *
 * `@main/metadata/steamStore` is mocked via `importOriginal` rather than a
 * flat object: `queue.ts` — exercised for real underneath this service —
 * checks `error instanceof SteamStoreError`, so the class has to survive
 * the mock alongside the faked `fetchAppDetails`.
 *
 * `@main/metadata/epicArtwork`'s `readEpicArtwork` resolves to a `Map`, not
 * an array: `service.ts` reads `.size` off it. An empty array happens not to
 * throw there, but would were a game with `storeId === 'epic'` ever seeded,
 * since `queue.ts` calls `.get` on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import {
  runMetadataService,
  type MetadataServiceOptions,
  BATCH_PAUSE_MS,
  RATE_LIMIT_PAUSE_MS
} from '@main/metadata/service'
import { SteamAppList } from '@main/metadata/steamAppList'
import { fetchAppDetails, SteamStoreError } from '@main/metadata/steamStore'
import { fetchArtwork, lookupBySteamAppId, searchExact } from '@main/metadata/steamGridDb'
import type { GameMetadata } from '@shared/metadata'

vi.mock('@main/metadata/steamStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/metadata/steamStore')>()
  return {
    ...actual,
    fetchAppDetails: vi.fn(async () => undefined)
  }
})
vi.mock('@main/metadata/steamGridDb', () => ({
  fetchArtwork: vi.fn(async () => []),
  lookupBySteamAppId: vi.fn(async () => undefined),
  searchExact: vi.fn(async () => undefined),
  SGDB_PAUSE_MS: 0
}))
vi.mock('@main/metadata/epicArtwork', () => ({
  readEpicArtwork: vi.fn(async () => new Map())
}))
// `SteamAppList.loadCache` reads a real file via node:fs/promises. Real disk
// I/O settles on Node's own event loop, on its own schedule, independent of
// the fake timers below — racing it against `vi.advanceTimersByTimeAsync`
// made calls after it fire before the read had actually settled. Faking the
// read as well keeps the whole chain on the same, fully-controlled clock.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
    writeFile: vi.fn(async () => undefined)
  }
})

beforeEach(() => {
  vi.useFakeTimers()
  // `verifiedSteamArtwork` (queue.ts) does a real HEAD fetch for any
  // Steam-derived image URL that doesn't match the store's own
  // `headerImage`. None of these tests care about artwork rows from that
  // path — SteamGridDB is covered separately — so every check answers "no"
  // and no real network call is ever attempted.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const T0 = 1_700_000_000

const fixture = (o: Partial<GameMetadata> = {}): GameMetadata => ({
  developers: [],
  publishers: [],
  genres: ['Action'],
  screenshots: [],
  shortDescription: 'Kurz',
  fetchAttempts: 0,
  ...o
})

describe('runMetadataService', () => {
  let db: DatabaseSync
  let games: GameRepository
  let metadata: MetadataRepository

  const baseOptions = (o: Partial<MetadataServiceOptions> = {}): MetadataServiceOptions => ({
    userDataDir: 'nonexistent-user-data-dir',
    ...o
  })

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    metadata = new MetadataRepository(db)
  })

  it('stops once nothing is left open', async () => {
    // Every game already has metadata: pendingGameIds has nothing to hand
    // back, so the very first pass should be the last.
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    metadata.upsert('steam:440', fixture({ steamAppId: 440, fetchedAt: T0 }), 'en')

    const promise = runMetadataService(games, metadata, baseOptions())
    await vi.advanceTimersByTimeAsync(1_000)
    await promise

    expect(fetchAppDetails).not.toHaveBeenCalled()
  })

  it('fetches details for a game that has none', async () => {
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    vi.mocked(fetchAppDetails).mockResolvedValueOnce(fixture({ steamAppId: 440 }))

    const promise = runMetadataService(games, metadata, baseOptions())
    // One pass fetches it (queue.ts pauses 1.5s per game), one more confirms
    // nothing is left, then the batch pause between the two.
    await vi.advanceTimersByTimeAsync(BATCH_PAUSE_MS + 2_000)
    await promise

    expect(fetchAppDetails).toHaveBeenCalledWith(440)
    const stored = metadata.get('steam:440', 'en')
    expect(stored?.steamAppId).toBe(440)
    expect(stored?.fetchedAt).toBeDefined()
  })

  it('carries on after a rate-limit block instead of giving up', async () => {
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    vi.mocked(fetchAppDetails)
      .mockRejectedValueOnce(new SteamStoreError('rate-limited', 'blocked'))
      .mockResolvedValueOnce(fixture({ steamAppId: 440 }))

    const promise = runMetadataService(games, metadata, baseOptions())

    // First pass: the block happens almost immediately.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchAppDetails).toHaveBeenCalledTimes(1)

    // Short of the pause, the second call must not have happened yet — this
    // is what pins the pause's actual length, not just its existence.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_PAUSE_MS - 2_000)
    expect(fetchAppDetails).toHaveBeenCalledTimes(1)

    // Past it, the retry fires.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetchAppDetails).toHaveBeenCalledTimes(2)

    // Let the now-successful pass and the following empty one settle.
    await vi.advanceTimersByTimeAsync(10_000)
    await promise
  })

  it('reports progress after every pass', async () => {
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    vi.mocked(fetchAppDetails).mockResolvedValueOnce(fixture({ steamAppId: 440 }))
    const onProgress = vi.fn()

    const promise = runMetadataService(games, metadata, baseOptions({ onProgress }))
    await vi.advanceTimersByTimeAsync(BATCH_PAUSE_MS + 2_000)
    await promise

    // Once after the pass that fetched the game, once after the following
    // pass finds nothing left — not just once at the very end.
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('needs no SteamGridDB key to run', async () => {
    // Metadata present but no artwork: a real gap gameIdsWithoutArtwork
    // would otherwise hand back — so this proves the key check happens
    // before any SteamGridDB call, not merely that there was nothing to do.
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    metadata.upsert('steam:440', fixture({ steamAppId: 440, fetchedAt: T0 }), 'en')

    const promise = runMetadataService(games, metadata, baseOptions({ steamGridDbKey: undefined }))
    await vi.advanceTimersByTimeAsync(1_000)
    await promise

    expect(fetchArtwork).not.toHaveBeenCalled()
  })

  it('closes an artwork gap when a SteamGridDB key is present', async () => {
    // The counter-case for the test above: with a key, and the same gap,
    // fetchArtwork is reached.
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    metadata.upsert('steam:440', fixture({ steamAppId: 440, fetchedAt: T0 }), 'en')
    vi.mocked(lookupBySteamAppId).mockResolvedValueOnce(9001)

    const promise = runMetadataService(
      games,
      metadata,
      baseOptions({ steamGridDbKey: 'sgdb-key' })
    )
    // Up to 3 artwork attempts before gameIdsWithoutArtwork gives up, each
    // separated by a batch pause.
    await vi.advanceTimersByTimeAsync(4 * BATCH_PAUSE_MS)
    await promise

    expect(fetchArtwork).toHaveBeenCalledWith(9001, { apiKey: 'sgdb-key' })
  })

  it('reuses the app list it was handed', async () => {
    // loadCache is called unconditionally, first thing, on whichever
    // instance the service ends up using. Spying on this specific instance
    // — rather than the class — proves that instance, not one created
    // internally, is what ran.
    const appList = new SteamAppList()
    const loadCache = vi.spyOn(appList, 'loadCache')

    const promise = runMetadataService(games, metadata, baseOptions({ appList }))
    await vi.advanceTimersByTimeAsync(1_000)
    await promise

    expect(loadCache).toHaveBeenCalledTimes(1)
  })
})
