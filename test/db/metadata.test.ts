import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { STEAM_ASSET_BASE, type GameMetadata } from '@shared/metadata'

const T0 = 1_700_000_000

function metadata(o: Partial<GameMetadata> = {}): Omit<GameMetadata, 'fetchAttempts'> {
  return {
    steamAppId: 1091500,
    matchSource: 'name-exact',
    shortDescription: 'Kurz',
    description: 'Lang',
    developers: ['CD PROJEKT RED'],
    publishers: ['CD PROJEKT RED'],
    genres: ['Rollenspiel', 'Action'],
    releaseDate: '9. Dez. 2020',
    metacritic: 86,
    screenshots: ['https://a/1.jpg', 'https://a/2.jpg'],
    fetchedAt: T0,
    ...o
  }
}

describe('MetadataRepository', () => {
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
    games.upsertScan('ubisoft', [{ storeGameId: '856', name: 'Far Cry 4', installed: true }], T0)
  })

  it('returns undefined for a game without metadata', () => {
    expect(repo.get('steam:440', 'de')).toBeUndefined()
  })

  it('stores and reads complete metadata', () => {
    repo.upsert('steam:1091500', metadata(), 'de')
    const read = repo.get('steam:1091500', 'de')!
    expect(read.steamAppId).toBe(1091500)
    expect(read.metacritic).toBe(86)
    expect(read.releaseDate).toBe('9. Dez. 2020')
  })

  it('carries lists through the database intact', () => {
    // Lists are stored as JSON text. A packing or unpacking bug would
    // otherwise only show up in the interface.
    repo.upsert('steam:1091500', metadata(), 'de')
    const read = repo.get('steam:1091500', 'de')!
    expect(read.genres).toEqual(['Rollenspiel', 'Action'])
    expect(read.screenshots).toHaveLength(2)
    expect(read.developers).toEqual(['CD PROJEKT RED'])
  })

  it('returns empty lists rather than undefined when nothing is stored', () => {
    // The interface should be able to call `.map()` without checking first.
    repo.upsert('steam:440', { developers: [], publishers: [], genres: [], screenshots: [] }, 'de')
    const read = repo.get('steam:440', 'de')!
    expect(read.genres).toEqual([])
    expect(read.screenshots).toEqual([])
  })

  it('does not overwrite a manual match with an automatic fetch', () => {
    // The central promise of this feature. Without it every correction
    // the user made would be gone on the next scan — and nobody would
    // notice, because the result looks "plausible".
    repo.setManualMatch('ubisoft:856', 298110)
    repo.upsert('ubisoft:856', metadata({ steamAppId: 999999, matchSource: 'name-exact' }), 'de')

    const read = repo.get('ubisoft:856', 'de')!
    expect(read.steamAppId).toBe(298110)
    expect(read.matchSource).toBe('manual')
  })

  it('lets an automatic fetch fill the remaining fields anyway', () => {
    // The manual match protects the AppID, not the description — otherwise
    // a manually matched game would stay content-free forever.
    repo.setManualMatch('ubisoft:856', 298110)
    repo.upsert('ubisoft:856', metadata({ steamAppId: 999999, shortDescription: 'Neu' }), 'de')
    expect(repo.get('ubisoft:856', 'de')!.shortDescription).toBe('Neu')
  })

  it('lets a new manual match replace the old one', () => {
    repo.setManualMatch('ubisoft:856', 298110)
    repo.setManualMatch('ubisoft:856', 220)
    expect(repo.get('ubisoft:856', 'de')!.steamAppId).toBe(220)
  })

  it('lists only games without metadata as pending', () => {
    repo.upsert('steam:1091500', metadata(), 'de')
    const offen = repo.pendingGameIds(3, 'de')
    expect(offen).not.toContain('steam:1091500')
    expect(offen).toContain('steam:440')
    expect(offen).toContain('ubisoft:856')
  })

  it('drops games with exhausted attempts from the queue', () => {
    // Ein Spiel, das Steam nicht kennt, darf nicht bei jedem Start erneut
    // abgefragt werden.
    for (let i = 0; i < 3; i++) repo.markFetchFailed('steam:440', T0 + i)
    expect(repo.pendingGameIds(3, 'de')).not.toContain('steam:440')
  })

  it('increments failed attempts rather than overwriting them', () => {
    repo.markFetchFailed('steam:440', T0)
    repo.markFetchFailed('steam:440', T0 + 1)
    expect(repo.get('steam:440', 'de')!.fetchAttempts).toBe(2)
  })

  it('stores and reads artwork per kind', () => {
    repo.upsertArtwork('steam:440', [
      { kind: 'grid', url: 'https://cdn/1.jpg' },
      { kind: 'hero', url: 'https://cdn/2.jpg' }
    ])
    const bilder = repo.artworkFor('steam:440')
    expect(bilder.map((b) => b.kind).sort()).toEqual(['grid', 'hero'])
  })

  it('replaces artwork of the same kind rather than duplicating it', () => {
    repo.upsertArtwork('steam:440', [{ kind: 'grid', url: 'https://alt' }])
    repo.upsertArtwork('steam:440', [{ kind: 'grid', url: 'https://neu' }])
    const bilder = repo.artworkFor('steam:440')
    expect(bilder).toHaveLength(1)
    expect(bilder[0]!.url).toBe('https://neu')
  })

  it('clears metadata and artwork when a game disappears', () => {
    // The foreign key with ON DELETE CASCADE. Games are never deleted,
    // but if they were, no orphans may be left behind.
    repo.upsert('steam:440', metadata(), 'de')
    repo.upsertArtwork('steam:440', [{ kind: 'grid', url: 'https://x' }])
    db.prepare('DELETE FROM games WHERE id = ?').run('steam:440')
    expect(repo.get('steam:440', 'de')).toBeUndefined()
    expect(repo.artworkFor('steam:440')).toEqual([])
  })

  it('survives a rescan of the library', () => {
    // Metadata hangs off the game ID, not off a scan row.
    repo.upsert('steam:440', metadata({ shortDescription: 'Stays' }), 'de')
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0 + 1)
    expect(repo.get('steam:440', 'de')!.shortDescription).toBe('Stays')
  })
})

describe('Correcting a wrong match', () => {
  let db: DatabaseSync
  let repo: MetadataRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    const games = new GameRepository(db)
    games.upsertScan('ubisoft', [{ storeGameId: '856', name: 'Far Cry 4', installed: true }], T0)
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    repo = new MetadataRepository(db)
  })

  it('discards all content of the wrongly matched game', () => {
    repo.upsert('ubisoft:856', metadata(), 'de')
    repo.setManualMatch('ubisoft:856', 298110)
    const after = repo.get('ubisoft:856', 'de')!

    expect(after.steamAppId).toBe(298110)
    expect(after.matchSource).toBe('manual')
    // Completely, not just the conspicuous fields: the later fetch fills
    // only empty fields via COALESCE. Whatever stays here stays wrong
    // permanently.
    expect(after.shortDescription).toBeUndefined()
    expect(after.description).toBeUndefined()
    expect(after.developers).toEqual([])
    expect(after.publishers).toEqual([])
    expect(after.genres).toEqual([])
    expect(after.releaseDate).toBeUndefined()
    expect(after.metacritic).toBeUndefined()
    expect(after.screenshots).toEqual([])
    expect(after.fetchedAt).toBeUndefined()
  })

  it('can be corrected a second time', () => {
    // The guard in upsert() protects 'manual' from the automatic source.
    // If it applied here too, a human could no longer put right their own
    // mistaken entry.
    repo.setManualMatch('ubisoft:856', 111)
    repo.setManualMatch('ubisoft:856', 222)
    expect(repo.get('ubisoft:856', 'de')?.steamAppId).toBe(222)
  })

  it('discards Steam images but keeps Epic ones', () => {
    repo.upsertArtwork('ubisoft:856', [
      { kind: 'grid', url: `${STEAM_ASSET_BASE}/999/library_600x900.jpg` },
      { kind: 'hero', url: 'https://cdn1.epicgames.com/item/EGS_FarCry4-1200x1600.jpg' }
    ])
    repo.clearSteamArtwork('ubisoft:856')

    const remaining = repo.artworkFor('ubisoft:856')
    expect(remaining).toHaveLength(1)
    // Epic image comes from the local catalogue and is correct regardless
    // of which Steam page is matched.
    expect(remaining[0]!.kind).toBe('hero')
  })

  it('leaves the images of other games untouched', () => {
    const url = `${STEAM_ASSET_BASE}/999/library_600x900.jpg`
    repo.upsertArtwork('ubisoft:856', [{ kind: 'grid', url }])
    repo.upsertArtwork('steam:440', [{ kind: 'grid', url }])
    repo.clearSteamArtwork('ubisoft:856')
    expect(repo.artworkFor('steam:440')).toHaveLength(1)
  })
})
