import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { runMetadataPass } from '@main/metadata/queue'
import type { GameMetadata } from '@shared/metadata'

const T0 = 1_700_000_000

const meta = (o: Partial<GameMetadata> = {}): GameMetadata => ({
  developers: [],
  publishers: [],
  genres: [],
  screenshots: [],
  fetchAttempts: 0,
  ...o
})

describe('Steam artwork is verified before it is stored', () => {
  let db: DatabaseSync
  let games: GameRepository
  let repo: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    repo = new MetadataRepository(db)
    // Assassin's Creed: Steam has a header for it but no library capsule.
    games.upsertScan(
      'steam',
      [{ storeGameId: '15100', name: "Assassin's Creed", installed: true }],
      T0
    )
  })

  const deps = (imageExists: (url: string) => Promise<boolean>) => ({
    findAppId: () => undefined,
    fetchDetails: async () => meta(),
    epicArtwork: new Map(),
    pause: async () => undefined,
    now: () => T0,
    imageExists
  })

  it('stores only the images that actually exist', async () => {
    // The whole defect in one test: the URL is built from the AppID, and
    // for 13 games here library_600x900 is a 404. Stored unchecked, the
    // row then counted as artwork and the tile stayed blank for good.
    await runMetadataPass(
      games,
      repo,
      deps(async (url) => !url.includes('library_600x900'))
    )

    expect(repo.artworkFor('steam:15100').map((a) => a.kind)).toEqual(['hero'])
  })

  it('leaves the game eligible for the fallback afterwards', async () => {
    await runMetadataPass(
      games,
      repo,
      deps(async (url) => !url.includes('library_600x900'))
    )

    expect(repo.gameIdsWithoutArtwork(10)).toContain('steam:15100')
  })

  it('stores both when both exist', async () => {
    await runMetadataPass(games, repo, deps(async () => true))

    expect(repo.artworkFor('steam:15100').map((a) => a.kind).sort()).toEqual(['grid', 'hero'])
  })

  it('stores nothing rather than guessing when the check itself fails', async () => {
    // Offline, or Valve unreachable. A URL that could not be confirmed must
    // not be written: an unverified row is exactly what caused this.
    await runMetadataPass(
      games,
      repo,
      deps(async () => {
        throw new Error('network down')
      })
    )

    expect(repo.artworkFor('steam:15100')).toEqual([])
  })
})
