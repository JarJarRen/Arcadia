import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'

const T0 = 1_700_000_000

describe('Finding games that need artwork', () => {
  let db: DatabaseSync
  let games: GameRepository
  let repo: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    repo = new MetadataRepository(db)
    games.upsertScan(
      'steam',
      [
        { storeGameId: '15100', name: "Assassin's Creed", installed: true },
        { storeGameId: '730', name: 'Counter-Strike 2', installed: true }
      ],
      T0
    )
  })

  it('offers a game that has only a header and no grid', () => {
    // The real shape of the bug. Steam has no library_600x900 for some
    // apps — 13 of them here — so only the header URL resolves. The tile
    // shows the grid, so such a game has no picture at all, yet the old
    // query skipped it because *some* artwork row existed.
    repo.upsertArtwork('steam:15100', [{ kind: 'hero', url: 'https://example/header.jpg' }])

    expect(repo.gameIdsWithoutArtwork(10)).toContain('steam:15100')
  })

  it('leaves a game alone once it has a grid', () => {
    repo.upsertArtwork('steam:730', [
      { kind: 'grid', url: 'https://example/library_600x900.jpg' },
      { kind: 'hero', url: 'https://example/header.jpg' }
    ])

    expect(repo.gameIdsWithoutArtwork(10)).not.toContain('steam:730')
  })

  it('still offers a game with no artwork at all', () => {
    expect(repo.gameIdsWithoutArtwork(10)).toContain('steam:730')
  })

  it('stops offering a game whose attempts are spent', () => {
    repo.markArtworkFailed('steam:15100')
    repo.markArtworkFailed('steam:15100')
    repo.markArtworkFailed('steam:15100')

    expect(repo.gameIdsWithoutArtwork(10)).not.toContain('steam:15100')
  })
})

describe('Discarding artwork that turned out not to exist', () => {
  let db: DatabaseSync
  let games: GameRepository
  let repo: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    games = new GameRepository(db)
    repo = new MetadataRepository(db)
    games.upsertScan(
      'steam',
      [{ storeGameId: '15100', name: "Assassin's Creed", installed: true }],
      T0
    )
    repo.upsertArtwork('steam:15100', [
      { kind: 'grid', url: 'https://example/library_600x900.jpg' },
      { kind: 'hero', url: 'https://example/header.jpg' }
    ])
  })

  it('removes only the kind that failed', () => {
    repo.removeArtwork('steam:15100', 'grid')

    const left = repo.artworkFor('steam:15100')
    expect(left.map((a) => a.kind)).toEqual(['hero'])
  })

  it('makes the game eligible for the fallback again', () => {
    expect(repo.gameIdsWithoutArtwork(10)).not.toContain('steam:15100')
    repo.removeArtwork('steam:15100', 'grid')
    expect(repo.gameIdsWithoutArtwork(10)).toContain('steam:15100')
  })

  it('does not reset the attempt counter', () => {
    // Deliberate. If SteamGridDB supplies a URL that is itself broken, the
    // renderer reports it, the row goes, and without a rising counter the
    // same URL would be fetched again on the next pass — for ever.
    repo.markArtworkFailed('steam:15100')
    repo.removeArtwork('steam:15100', 'grid')

    expect(repo.get('steam:15100', 'en')?.fetchAttempts).toBeDefined()
    const attempts = db
      .prepare('SELECT artwork_attempts AS n FROM metadata WHERE game_id = ?')
      .get('steam:15100') as unknown as { n: number }
    expect(attempts.n).toBe(1)
  })

  it('is harmless for a game that has no such artwork', () => {
    expect(() => repo.removeArtwork('steam:15100', 'logo')).not.toThrow()
  })
})
