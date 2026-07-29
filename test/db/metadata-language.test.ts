import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import type { GameMetadata } from '@shared/metadata'

const T0 = 1_700_000_000

function english(o: Partial<GameMetadata> = {}): Omit<GameMetadata, 'fetchAttempts'> {
  return {
    steamAppId: 1091500,
    matchSource: 'name-exact',
    shortDescription: 'Short',
    description: 'Long',
    developers: ['CD PROJEKT RED'],
    publishers: ['CD PROJEKT RED'],
    genres: ['RPG', 'Action'],
    releaseDate: '9 Dec, 2020',
    metacritic: 86,
    screenshots: ['https://a/1.jpg'],
    fetchedAt: T0,
    ...o
  }
}

function german(o: Partial<GameMetadata> = {}): Omit<GameMetadata, 'fetchAttempts'> {
  return english({
    shortDescription: 'Kurz',
    description: 'Lang',
    genres: ['Rollenspiel', 'Action'],
    releaseDate: '9. Dez. 2020',
    ...o
  })
}

describe('MetadataRepository — one row per language', () => {
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
        { storeGameId: '1091500', name: 'Cyberpunk 2077', installed: true },
        { storeGameId: '440', name: 'TF2', installed: true }
      ],
      T0
    )
  })

  it('keeps both languages side by side', () => {
    repo.upsert('steam:1091500', english(), 'en')
    repo.upsert('steam:1091500', german(), 'de')

    expect(repo.get('steam:1091500', 'en')?.description).toBe('Long')
    expect(repo.get('steam:1091500', 'de')?.description).toBe('Lang')
  })

  it('does not let one language overwrite the other', () => {
    // The whole reason for the second table. Writing German after English
    // must leave the English row untouched.
    repo.upsert('steam:1091500', english(), 'en')
    repo.upsert('steam:1091500', german(), 'de')
    repo.upsert('steam:1091500', german({ description: 'Neu' }), 'de')

    expect(repo.get('steam:1091500', 'en')?.description).toBe('Long')
    expect(repo.get('steam:1091500', 'de')?.description).toBe('Neu')
  })

  it('shares the language-independent fields between languages', () => {
    // Screenshots, developers and the Metacritic score do not differ by
    // language. Storing them twice would double the largest column for
    // nothing, so they live in `metadata` and both languages see them.
    repo.upsert('steam:1091500', english(), 'en')

    const de = repo.get('steam:1091500', 'de')
    expect(de?.screenshots).toEqual(['https://a/1.jpg'])
    expect(de?.developers).toEqual(['CD PROJEKT RED'])
    expect(de?.metacritic).toBe(86)
    // …but the text for that language is not there yet.
    expect(de?.description).toBeUndefined()
  })

  it('reports a game as pending for a language it lacks text in', () => {
    repo.upsert('steam:1091500', english(), 'en')

    expect(repo.pendingGameIds(10, 'en')).not.toContain('steam:1091500')
    expect(repo.pendingGameIds(10, 'de')).toContain('steam:1091500')
  })

  it('still reports games with no metadata at all as pending', () => {
    expect(repo.pendingGameIds(10, 'en')).toContain('steam:440')
  })

  it('clears the text of every language on a manual match', () => {
    // The text belongs to the previously matched, wrong game. Leaving the
    // other language behind would keep the wrong description reachable by
    // switching language — the exact bug the manual match exists to fix.
    repo.upsert('steam:1091500', english(), 'en')
    repo.upsert('steam:1091500', german(), 'de')

    repo.setManualMatch('steam:1091500', 292030)

    expect(repo.get('steam:1091500', 'en')?.description).toBeUndefined()
    expect(repo.get('steam:1091500', 'de')?.description).toBeUndefined()
    expect(repo.get('steam:1091500', 'en')?.steamAppId).toBe(292030)
  })

  it('removes the text rows when the game goes', () => {
    repo.upsert('steam:1091500', english(), 'en')
    db.exec("DELETE FROM games WHERE id = 'steam:1091500'")

    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM metadata_text WHERE game_id = ?')
      .get('steam:1091500') as unknown as { n: number }
    expect(rows.n).toBe(0)
  })
})
