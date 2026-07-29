import { describe, expect, it } from 'vitest'
import { formatLastPlayed, pickArtwork, storeOrigins } from '../../src/renderer/detail'
import type { Game, StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'
import type { ArtworkRef } from '@shared/metadata'

function game(storeId: StoreId, id: string, o: Partial<Game> = {}): Game {
  return {
    id: `${storeId}:${id}`,
    storeId,
    storeGameId: id,
    name: 'Far Cry 4',
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    ...o
  }
}

function entry(sources: Game[], o: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    key: 'far cry 4',
    sources,
    active: sources[0]!,
    name: 'Far Cry 4',
    installed: sources.some((source) => source.installed),
    favorite: false,
    artwork: [],
    sharedOrFree: false,
    ...o
  }
}

const image = (kind: ArtworkRef['kind'], url = `https://x/${kind}.jpg`): ArtworkRef => ({
  kind,
  url
})

describe('pickArtwork', () => {
  it('takes the requested kind when it exists', () => {
    const chosen = pickArtwork([image('grid'), image('hero')], 'hero')
    expect(chosen?.url).toBe('https://x/hero.jpg')
  })

  it('falls back from hero to grid', () => {
    expect(pickArtwork([image('grid')], 'hero')?.kind).toBe('grid')
  })

  it('falls back from grid to hero', () => {
    expect(pickArtwork([image('hero')], 'grid')?.kind).toBe('hero')
  })

  it('takes no substitute for a logo', () => {
    // A logo is cut out; a header image in its place would not be a
    // stopgap but simply wrong — hence no chain here.
    expect(pickArtwork([image('hero'), image('grid')], 'logo')).toBeUndefined()
  })

  it('returns undefined when there is nothing at all', () => {
    // The normal case for games whose metadata has not been fetched yet.
    expect(pickArtwork([], 'hero')).toBeUndefined()
  })
})

describe('formatLastPlayed', () => {
  it('formats a timestamp as a date', () => {
    // 9 November 2023, 06:00 UTC — deliberately far from midnight so the
    // test machine's time zone cannot tip the day over.
    expect(formatLastPlayed(1699509600)).toBe('9 November 2023')
  })

  it('treats 0 as "never played", not as 1970', () => {
    // Steam writes 0 for never played. Without this case the page would
    // claim 1 January 1970 as a play date.
    expect(formatLastPlayed(0)).toBeUndefined()
  })

  it('returns undefined for a missing value', () => {
    expect(formatLastPlayed(undefined)).toBeUndefined()
  })

  it('returns undefined rather than "Invalid Date" for a nonsense value', () => {
    expect(formatLastPlayed(Number.MAX_SAFE_INTEGER)).toBeUndefined()
  })
})

describe('storeOrigins', () => {
  it('lists every source and marks the active one', () => {
    const e = entry([game('steam', '298110'), game('ubisoft', '856', { installed: false })])
    expect(storeOrigins(e)).toEqual([
      { gameId: 'steam:298110', storeId: 'steam', installed: true, active: true },
      { gameId: 'ubisoft:856', storeId: 'ubisoft', installed: false, active: false }
    ])
  })

  it('marks the active source even when it is not the first', () => {
    const sources = [game('steam', '298110'), game('ubisoft', '856')]
    const e = entry(sources, { active: sources[1]! })
    expect(storeOrigins(e).map((origin) => origin.active)).toEqual([false, true])
  })
})
