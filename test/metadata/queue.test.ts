import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'
import { runMetadataPass, type MetadataDeps } from '@main/metadata/queue'
import { SteamStoreError } from '@main/metadata/steamStore'
import type { GameMetadata } from '@shared/metadata'

const T0 = 1_700_000_000

const meta = (o: Partial<GameMetadata> = {}): GameMetadata => ({
  developers: [],
  publishers: [],
  genres: ['Action'],
  screenshots: [],
  shortDescription: 'Kurz',
  fetchAttempts: 0,
  ...o
})

describe('runMetadataPass', () => {
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

  it('uses the AppID directly for Steam games, without name matching', async () => {
    // The storeGameId IS the AppID. Name matching would not only be
    // redundant, it could actually go wrong.
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    let abgeglichen = false
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      findAppId: () => {
        abgeglichen = true
        return 999
      },
      fetchDetails: async (id) => meta({ steamAppId: id })
    })
    expect(abgeglichen).toBe(false)
    expect(metaRepo.get('steam:440', 'en')!.steamAppId).toBe(440)
    expect(metaRepo.get('steam:440', 'en')!.matchSource).toBe('steam-appid')
  })

  it('matches non-Steam games by name', async () => {
    games.upsertScan('ubisoft', [{ storeGameId: '856', name: 'Far Cry 4', installed: true }], T0)
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      findAppId: (name) => (name === 'Far Cry 4' ? 298110 : undefined),
      fetchDetails: async (id) => meta({ steamAppId: id })
    })
    const gespeichert = metaRepo.get('ubisoft:856', 'en')!
    expect(gespeichert.steamAppId).toBe(298110)
    expect(gespeichert.matchSource).toBe('name-exact')
  })

  it('records a failure when the name is not found', async () => {
    // Otherwise the game would come up on every pass, even though it is
    // ist, dass Steam es nicht kennt.
    games.upsertScan('epic', [{ storeGameId: 'x', name: 'Fortnite', installed: true }], T0)
    await runMetadataPass(games, metaRepo, baseDeps())
    expect(metaRepo.get('epic:x', 'en')!.fetchAttempts).toBe(1)
    expect(metaRepo.get('epic:x', 'en')!.fetchedAt).toBeUndefined()
  })

  it('records Epic artwork even when Steam does not know the game', async () => {
    // The real win: artwork and description are separate sources.
    // Steam never finds Fortnite — it should still get an image.
    games.upsertScan('epic', [{ storeGameId: 'kat1', name: 'Fortnite', installed: true }], T0)
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      findAppId: () => undefined,
      epicArtwork: new Map([
        ['kat1', [{ kind: 'grid' as const, url: 'https://cdn1.epicgames.com/g.jpg' }]]
      ])
    })
    expect(metaRepo.artworkFor('epic:kat1')).toHaveLength(1)
    // Without a Steam hit the description stays a failed attempt.
    expect(metaRepo.get('epic:kat1', 'en')!.fetchAttempts).toBe(1)
  })

  it('fetches both for an Epic game that has a Steam hit', async () => {
    games.upsertScan('epic', [{ storeGameId: 'kat2', name: 'Hogwarts Legacy', installed: true }], T0)
    let fetched = 0
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      findAppId: () => 990080,
      fetchDetails: async (id) => {
        fetched++
        return meta({ steamAppId: id })
      },
      epicArtwork: new Map([
        ['kat2', [{ kind: 'grid' as const, url: 'https://cdn1.epicgames.com/h.jpg' }]]
      ])
    })
    expect(fetched).toBe(1)
    expect(metaRepo.get('epic:kat2', 'en')!.genres).toEqual(['Action'])
    // Epic image must not be displaced by the Steam one: it is the better
    // fit for an Epic game.
    expect(metaRepo.artworkFor('epic:kat2').find((b) => b.kind === 'grid')!.url).toContain(
      'epicgames'
    )
  })

  it('creates Steam artwork from the AppID', async () => {
    // Steams Bild-URLs folgen einem festen Schema und brauchen keinen
    // eigenen Abruf.
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      fetchDetails: async (id) => meta({ steamAppId: id })
    })
    const bilder = metaRepo.artworkFor('steam:440')
    expect(bilder.map((b) => b.kind).sort()).toEqual(['grid', 'hero'])
    expect(bilder.every((b) => b.url.startsWith('https://'))).toBe(true)
  })

  it('slows down between fetches', async () => {
    // The store API rate-limits noticeably. Without a pause the first pass
    // over 193 games would run into a block.
    games.upsertScan(
      'steam',
      [
        { storeGameId: '1', name: 'A', installed: true },
        { storeGameId: '2', name: 'B', installed: true }
      ],
      T0
    )
    const pausen: number[] = []
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      fetchDetails: async (id) => meta({ steamAppId: id }),
      pause: async (ms) => {
        pausen.push(ms)
      }
    })
    expect(pausen.length).toBeGreaterThanOrEqual(2)
    expect(Math.min(...pausen)).toBeGreaterThanOrEqual(1000)
  })

  it('stops on rate limiting rather than running on', async () => {
    // After a 429 only waiting helps. Further fetches merely extend the
    // block — the rest comes up on the next pass.
    games.upsertScan(
      'steam',
      [
        { storeGameId: '1', name: 'A', installed: true },
        { storeGameId: '2', name: 'B', installed: true },
        { storeGameId: '3', name: 'C', installed: true }
      ],
      T0
    )
    let versuche = 0
    const ergebnis = await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      fetchDetails: async () => {
        versuche++
        throw new SteamStoreError('rate-limited', 'gebremst')
      }
    })
    expect(versuche).toBe(1)
    expect(ergebnis.rateLimited).toBe(true)
    // Kein Fehlversuch angerechnet: das Spiel ist nicht schuld.
    expect(metaRepo.get('steam:1', 'en')?.fetchAttempts ?? 0).toBe(0)
  })

  it('does not let a single failure hold up the rest', async () => {
    games.upsertScan(
      'steam',
      [
        { storeGameId: '1', name: 'Broken', installed: true },
        { storeGameId: '2', name: 'Heil', installed: true }
      ],
      T0
    )
    const ergebnis = await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      fetchDetails: async (id) => {
        if (id === 1) throw new SteamStoreError('unexpected', 'kaputt')
        return meta({ steamAppId: id })
      }
    })
    expect(metaRepo.get('steam:2', 'en')!.genres).toEqual(['Action'])
    expect(ergebnis.failed).toBe(1)
    expect(ergebnis.succeeded).toBe(1)
  })

  it('skips games that already have metadata', async () => {
    games.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    metaRepo.upsert('steam:440', meta({ steamAppId: 440, fetchedAt: T0 }), 'en')
    let fetched = 0
    await runMetadataPass(games, metaRepo, {
      ...baseDeps(),
      fetchDetails: async () => {
        fetched++
        return undefined
      }
    })
    expect(fetched).toBe(0)
  })

  it('fetches no more games than allowed', async () => {
    // The first pass over 193 games should not keep the app busy for
    // minutes; the rest comes next time.
    games.upsertScan(
      'steam',
      Array.from({ length: 20 }, (_, i) => ({
        storeGameId: String(i),
        name: `Spiel ${i}`,
        installed: true
      })),
      T0
    )
    let fetched = 0
    await runMetadataPass(
      games,
      metaRepo,
      {
        ...baseDeps(),
        fetchDetails: async (id) => {
          fetched++
          return meta({ steamAppId: id })
        }
      },
      5
    )
    expect(fetched).toBe(5)
  })
})
