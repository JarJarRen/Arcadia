import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { runMetadataPass } from '@main/metadata/queue'
import { fetchAppDetails } from '@main/metadata/steamStore'
import type { GameMetadata } from '@shared/metadata'

const T0 = 1_700_000_000

/**
 * Steam moved newer titles to a hashed asset path.
 *
 * `RV There Yet?` (AppID 3949040) serves nothing at the derived
 * `/apps/3949040/header.jpg` — measured, along with every other CDN host.
 * The real URL carries a content hash between AppID and filename, and only
 * the store API knows it. Older titles such as Team Fortress 2 keep the flat
 * layout, which is why the derived scheme looked correct for years.
 *
 * Each asset has its own hash: `library_600x900.jpg` is a 404 under the
 * header's hash too, and the API does not report a portrait capsule at all.
 * The grid therefore stays SteamGridDB's job — only the hero is recoverable
 * here.
 */
const HASHED_HEADER =
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps' +
  '/3949040/cae24b4ed7f4531be51f0d63f785b7d253f92dc3/header.jpg?t=1778071815'

const meta = (o: Partial<GameMetadata> = {}): GameMetadata => ({
  developers: [],
  publishers: [],
  genres: [],
  screenshots: [],
  fetchAttempts: 0,
  ...o
})

const response = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body
})

describe('the header URL reported by the store', () => {
  it('is read out of the store response', async () => {
    const data = await fetchAppDetails(3949040, {
      language: 'english',
      fetchFn: async () =>
        response({
          '3949040': {
            success: true,
            data: { type: 'game', name: 'RV There Yet?', header_image: HASHED_HEADER }
          }
        })
    })

    expect(data?.headerImage).toBe(HASHED_HEADER)
  })

  it('is left unset when the store does not report one', async () => {
    const data = await fetchAppDetails(440, {
      language: 'english',
      fetchFn: async () =>
        response({ '440': { success: true, data: { type: 'game', name: 'Team Fortress 2' } } })
    })

    expect(data?.headerImage).toBeUndefined()
  })

  it('is ignored when it is not a string', async () => {
    const data = await fetchAppDetails(440, {
      language: 'english',
      fetchFn: async () =>
        response({ '440': { success: true, data: { type: 'game', header_image: 42 } } })
    })

    expect(data?.headerImage).toBeUndefined()
  })
})

describe('artwork for a game on the hashed asset path', () => {
  let db: DatabaseSync
  let games: GameRepository
  let repo: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    repo = new MetadataRepository(db)
    games.upsertScan('steam', [{ storeGameId: '3949040', name: 'RV There Yet?', installed: true }], T0)
  })

  /** Valve serves the hashed header and nothing that is derived from the AppID. */
  const onlyHashed = async (url: string) => url === HASHED_HEADER

  const deps = (data: GameMetadata, imageExists = onlyHashed) => ({
    findAppId: () => undefined,
    fetchDetails: async () => data,
    epicArtwork: new Map(),
    pause: async () => undefined,
    now: () => T0,
    imageExists
  })

  it('uses the reported header as the hero', async () => {
    await runMetadataPass(games, repo, deps(meta({ headerImage: HASHED_HEADER })))

    expect(repo.artworkFor('steam:3949040')).toEqual([{ kind: 'hero', url: HASHED_HEADER }])
  })

  it('still leaves the grid to the fallback', async () => {
    // The store API reports no portrait capsule, and the hashed path has
    // none either. Without this the game would count as "has artwork" and
    // never reach SteamGridDB, which does have 24 grids for it.
    await runMetadataPass(games, repo, deps(meta({ headerImage: HASHED_HEADER })))

    expect(repo.gameIdsWithoutArtwork(10)).toContain('steam:3949040')
  })

  it('falls back to the derived URL for a game on the flat path', async () => {
    // Team Fortress 2's shape: no header_image reported, but the derived
    // URL answers. Nothing may regress for the 196 games in this state.
    await runMetadataPass(games, repo, deps(meta(), async () => true))

    expect(repo.artworkFor('steam:3949040').map((a) => a.url).sort()).toEqual([
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3949040/header.jpg',
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3949040/library_600x900.jpg'
    ])
  })

  it('does not check the reported header against the CDN', async () => {
    // Steam itself handed the URL over. A HEAD request would only add a
    // round trip per game to confirm what the API already stated.
    const checked: string[] = []
    await runMetadataPass(
      games,
      repo,
      deps(meta({ headerImage: HASHED_HEADER }), async (url) => {
        checked.push(url)
        return false
      })
    )

    expect(checked).not.toContain(HASHED_HEADER)
  })
})
