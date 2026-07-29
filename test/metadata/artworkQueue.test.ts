import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { runArtworkPass, type ArtworkDeps } from '@main/metadata/artworkQueue'

const T0 = 1_700_000_000
const IMAGES = [
  { kind: 'grid' as const, url: 'https://cdn2.steamgriddb.com/grid/a.png' },
  { kind: 'hero' as const, url: 'https://cdn2.steamgriddb.com/hero/b.jpg' }
]

function deps(overrides: Partial<ArtworkDeps> = {}): ArtworkDeps {
  return {
    lookupBySteamAppId: vi.fn(async () => 3095),
    searchExact: vi.fn(async () => 5268147),
    fetchArtwork: vi.fn(async () => IMAGES),
    pause: vi.fn(async () => undefined),
    pauseMs: 0,
    ...overrides
  }
}

describe('runArtworkPass', () => {
  let db: DatabaseSync
  let games: GameRepository
  let metadata: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    metadata = new MetadataRepository(db)
    games.upsertScan(
      'steam',
      [{ storeGameId: '252490', name: 'Rust - Staging Branch', installed: true }],
      T0
    )
    games.upsertScan(
      'epic',
      [{ storeGameId: 'fm21', name: 'Football Manager 2021', installed: true }],
      T0
    )
  })

  it('closes a gap and writes both image kinds', async () => {
    const result = await runArtworkPass(games, metadata, deps())

    expect(result.found).toBe(2)
    expect(metadata.artworkFor('steam:252490')).toHaveLength(2)
  })

  it('looks Steam games up by AppID, not by name', async () => {
    // For Steam the storeGameId IS the AppID, and SteamGridDB keeps an
    // index on it: all 14 Steam gaps checked were found that way. Name
    // matching here could only go wrong — "Rust - Staging Branch" is simply
    // called "Rust" over there.
    const d = deps()
    await runArtworkPass(games, metadata, d)

    expect(d.lookupBySteamAppId).toHaveBeenCalledWith(252490)
    // The Epic game may be searched for, the Steam game may not.
    expect(d.searchExact).toHaveBeenCalledTimes(1)
    expect(d.searchExact).toHaveBeenCalledWith('Football Manager 2021')
  })

  it('prefers a known AppID over the name for non-Steam games', async () => {
    // A matched AppID — automatic or manual — is more precise than any
    // name.
    metadata.upsert('epic:fm21', { steamAppId: 1263850, matchSource: 'name-exact' }, 'en')
    const d = deps()
    await runArtworkPass(games, metadata, d)

    expect(d.lookupBySteamAppId).toHaveBeenCalledWith(1263850)
    expect(d.searchExact).not.toHaveBeenCalled()
  })

  it('records a failed attempt when nothing is found', async () => {
    // Without the record the app would run against the same hopeless cases
    // on every start — measured, that is two out of 17.
    const d = deps({
      lookupBySteamAppId: vi.fn(async () => undefined),
      searchExact: vi.fn(async () => undefined)
    })
    const result = await runArtworkPass(games, metadata, d)

    expect(result.noMatch).toBe(2)
    expect(metadata.get('steam:252490', 'en')?.fetchAttempts).toBe(0)
  })

  it('gives up after three failed attempts', async () => {
    const d = deps({
      lookupBySteamAppId: vi.fn(async () => undefined),
      searchExact: vi.fn(async () => undefined)
    })
    for (let i = 0; i < 3; i++) await runArtworkPass(games, metadata, d)

    const last = await runArtworkPass(games, metadata, d)
    expect(last.considered).toBe(0)
  })

  it('records a failed attempt when the game is known but has no images', async () => {
    const d = deps({ fetchArtwork: vi.fn(async () => []) })
    const result = await runArtworkPass(games, metadata, d)
    expect(result.noMatch).toBe(2)
    expect(result.found).toBe(0)
  })

  it('does not touch games that already have an image', async () => {
    metadata.upsertArtwork('steam:252490', [IMAGES[0]!])
    const d = deps()
    const result = await runArtworkPass(games, metadata, d)

    expect(result.considered).toBe(1)
    expect(d.lookupBySteamAppId).not.toHaveBeenCalled()
  })

  it('pauses between the fetches', async () => {
    // The response carries no x-ratelimit header; without any word on the
    // permitted rate, pausing is conservative.
    const d = deps({ pauseMs: 600 })
    await runArtworkPass(games, metadata, d)
    expect(d.pause).toHaveBeenCalledWith(600)
  })

  it('honours the batch size', async () => {
    const result = await runArtworkPass(games, metadata, deps(), 1)
    expect(result.considered).toBe(1)
  })
})
