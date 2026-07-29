import { describe, expect, it } from 'vitest'
import {
  filterGames,
  formatPlaytime,
  formatSize,
  sortGames,
  type LibraryFilter
} from '../../src/renderer/filter'
import type { Game, StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'

function game(storeId: StoreId, id: string, name: string, o: Partial<Game> = {}): Game {
  return {
    id: `${storeId}:${id}`,
    storeId,
    storeGameId: id,
    name,
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    ...o
  }
}

/** Builds an entry from any number of sources. */
function entry(name: string, sources: Game[], o: Partial<LibraryEntry> = {}): LibraryEntry {
  const active = sources[0]!
  return {
    key: name.toLowerCase(),
    sources,
    active,
    name,
    installed: sources.some((s) => s.installed),
    favorite: sources.some((s) => s.favorite),
    installPath: active.installPath,
    installSizeBytes: active.installSizeBytes,
    playtimeMinutes: active.playtimeMinutes,
    lastPlayed: active.lastPlayed,
    artwork: [],
    sharedOrFree: false,
    ...o
  }
}

const ENTRIES: LibraryEntry[] = [
  entry('Team Fortress 2', [game('steam', '1', 'Team Fortress 2')]),
  entry('Counter-Strike 2', [game('steam', '2', 'Counter-Strike 2', { installed: false })]),
  entry('Fortnite', [game('epic', '3', 'Fortnite', { favorite: true })]),
  // The real case from the development machine: two sources, installed only
  // on Steam.
  entry('Far Cry 4', [
    game('steam', '298110', 'Far Cry 4'),
    game('ubisoft', '856', 'Far Cry 4', { installed: false })
  ])
]

const BASE: LibraryFilter = {
  search: '',
  store: 'all',
  onlyInstalled: false,
  onlyFavorites: false,
  shared: 'all'
}

/** Two licensed games and two shared/free ones. */
const SHARED_MIX: LibraryEntry[] = [
  entry('Anno 1800', [game('steam', '10', 'Anno 1800')], { sharedOrFree: true }),
  entry('Team Fortress 2', [game('steam', '11', 'Team Fortress 2')], { sharedOrFree: true }),
  entry('Far Cry 4', [game('steam', '12', 'Far Cry 4')]),
  entry('Foretales', [game('epic', '13', 'Foretales')])
]

describe('filterGames — shared/free', () => {
  it('returns both kinds in the "all" state', () => {
    expect(filterGames(SHARED_MIX, BASE)).toHaveLength(4)
  })

  it('keeps only shared/free games in the "only" state', () => {
    const names = filterGames(SHARED_MIX, { ...BASE, shared: 'only' }).map((e) => e.name)
    expect(names.sort()).toEqual(['Anno 1800', 'Team Fortress 2'])
  })

  it('drops shared/free games in the "exclude" state', () => {
    // The state that answers "what do I actually own a licence for?" — the
    // reason this is a select and not a checkbox.
    const names = filterGames(SHARED_MIX, { ...BASE, shared: 'exclude' }).map((e) => e.name)
    expect(names.sort()).toEqual(['Far Cry 4', 'Foretales'])
  })

  it('combines with the other filters by AND', () => {
    // Anno is shared AND on Steam; Foretales is licensed AND on Epic. Asking
    // for shared+Epic must therefore return nothing rather than falling back
    // to either half.
    expect(filterGames(SHARED_MIX, { ...BASE, shared: 'only', store: 'epic' })).toEqual([])
  })
})

describe('filterGames', () => {
  it('returns everything without a filter', () => {
    expect(filterGames(ENTRIES, BASE)).toHaveLength(4)
  })

  it('searches without regard to case', () => {
    expect(filterGames(ENTRIES, { ...BASE, search: 'fortress' }).map((e) => e.name)).toEqual([
      'Team Fortress 2'
    ])
  })

  it('finds partial matches in the middle too', () => {
    expect(filterGames(ENTRIES, { ...BASE, search: 'strike' }).map((e) => e.name)).toEqual([
      'Counter-Strike 2'
    ])
  })

  it('filters by store', () => {
    expect(filterGames(ENTRIES, { ...BASE, store: 'epic' }).map((e) => e.name)).toEqual([
      'Fortnite'
    ])
  })

  it('finds a merged game under EVERY one of its stores', () => {
    // Far Cry 4 belongs to Steam and Ubisoft. If only the active source
    // were checked, it would vanish when filtering by Ubisoft — even though
    // it is very much registered there.
    expect(filterGames(ENTRIES, { ...BASE, store: 'ubisoft' }).map((e) => e.name)).toEqual([
      'Far Cry 4'
    ])
    expect(filterGames(ENTRIES, { ...BASE, store: 'steam' }).map((e) => e.name)).toContain(
      'Far Cry 4'
    )
  })

  it('filters by install state', () => {
    expect(filterGames(ENTRIES, { ...BASE, onlyInstalled: true }).map((e) => e.name)).toEqual([
      'Team Fortress 2',
      'Fortnite',
      'Far Cry 4'
    ])
  })

  it('filters by favourites', () => {
    expect(filterGames(ENTRIES, { ...BASE, onlyFavorites: true }).map((e) => e.name)).toEqual([
      'Fortnite'
    ])
  })

  it('combines filters with AND', () => {
    expect(
      filterGames(ENTRIES, { ...BASE, store: 'steam', onlyInstalled: true }).map((e) => e.name)
    ).toEqual(['Team Fortress 2', 'Far Cry 4'])
  })

  it('ignores surrounding whitespace in the search', () => {
    expect(filterGames(ENTRIES, { ...BASE, search: '  fortnite  ' })).toHaveLength(1)
  })
})

describe('sortGames', () => {
  const s = (name: string, o: Partial<Game> = {}): LibraryEntry =>
    entry(name, [game('steam', name, name, o)])

  it('sorts by name regardless of case', () => {
    // 'apple' against 'Zebra': a pure code-point sort would put 'Zebra'
    // first.
    expect(sortGames([s('Zebra'), s('apple')], 'name').map((e) => e.name)).toEqual([
      'apple',
      'Zebra'
    ])
  })

  it('sorts by playtime descending, values-missing last', () => {
    const list = [s('A'), s('B', { playtimeMinutes: 500 }), s('C', { playtimeMinutes: 100 })]
    expect(sortGames(list, 'playtime').map((e) => e.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by last played, values-missing last', () => {
    const list = [s('A'), s('B', { lastPlayed: 100 }), s('C', { lastPlayed: 900 })]
    expect(sortGames(list, 'lastPlayed').map((e) => e.name)).toEqual(['C', 'B', 'A'])
  })

  it('sorts by size descending', () => {
    const list = [s('A', { installSizeBytes: 100 }), s('B'), s('C', { installSizeBytes: 900 })]
    expect(sortGames(list, 'size').map((e) => e.name)).toEqual(['C', 'A', 'B'])
  })

  it('does not mutate the input array', () => {
    const list = [s('zork'), s('Ape')]
    sortGames(list, 'name')
    expect(list.map((e) => e.name)).toEqual(['zork', 'Ape'])
  })
})

describe('formatPlaytime', () => {
  it('shows minutes below an hour', () => {
    expect(formatPlaytime(45)).toBe('45 min')
  })

  it('rounds to whole hours from an hour upwards', () => {
    expect(formatPlaytime(90)).toBe('2 h')
    expect(formatPlaytime(388_777)).toBe('6480 h')
  })

  it('returns undefined for 0 so the UI can hide the field', () => {
    expect(formatPlaytime(0)).toBeUndefined()
  })

  it('returns undefined for a missing value', () => {
    expect(formatPlaytime(undefined)).toBeUndefined()
  })
})

describe('formatSize', () => {
  it('shows gigabytes with one decimal place', () => {
    expect(formatSize(24_696_061_952)).toBe('23.0 GB')
  })

  it('shows megabytes below a gigabyte', () => {
    expect(formatSize(52_428_800)).toBe('50 MB')
  })

  it('returns undefined for 0', () => {
    expect(formatSize(0)).toBeUndefined()
  })

  it('returns undefined for a missing value', () => {
    expect(formatSize(undefined)).toBeUndefined()
  })
})
