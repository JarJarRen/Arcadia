import { describe, expect, it } from 'vitest'
import {
  filterGames,
  formatPlaytime,
  formatSize,
  sortGames,
  storeFilterLabel,
  storeFilterTitle,
  toggleStore,
  type LibraryFilter
} from '../../src/renderer/filter'
import type { Game, StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'
import { entry, game } from '../fixtures/library'

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
  stores: [],
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
    expect(filterGames(SHARED_MIX, { ...BASE, shared: 'only', stores: ['epic'] })).toEqual([])
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
    expect(filterGames(ENTRIES, { ...BASE, stores: ['epic'] }).map((e) => e.name)).toEqual([
      'Fortnite'
    ])
  })

  it('treats an empty selection as every store', () => {
    // The neutral state. Unticking the last store must show the whole
    // library, not an empty one.
    expect(filterGames(ENTRIES, { ...BASE, stores: [] })).toHaveLength(4)
  })

  it('keeps a game belonging to ANY of the selected stores', () => {
    // Several stores are ORed: asking for Steam and Epic means "either",
    // never "both at once" — no game would survive that.
    expect(filterGames(ENTRIES, { ...BASE, stores: ['steam', 'epic'] }).map((e) => e.name)).toEqual(
      ['Team Fortress 2', 'Counter-Strike 2', 'Fortnite', 'Far Cry 4']
    )
  })

  it('drops games belonging to none of the selected stores', () => {
    expect(filterGames(ENTRIES, { ...BASE, stores: ['epic', 'ea'] }).map((e) => e.name)).toEqual([
      'Fortnite'
    ])
  })

  it('finds a merged game under EVERY one of its stores', () => {
    // Far Cry 4 belongs to Steam and Ubisoft. If only the active source
    // were checked, it would vanish when filtering by Ubisoft — even though
    // it is very much registered there.
    expect(filterGames(ENTRIES, { ...BASE, stores: ['ubisoft'] }).map((e) => e.name)).toEqual([
      'Far Cry 4'
    ])
    expect(filterGames(ENTRIES, { ...BASE, stores: ['steam'] }).map((e) => e.name)).toContain(
      'Far Cry 4'
    )
  })

  it('counts a merged game once when both its stores are selected', () => {
    const names = filterGames(ENTRIES, { ...BASE, stores: ['steam', 'ubisoft'] }).map(
      (e) => e.name
    )
    expect(names.filter((name) => name === 'Far Cry 4')).toHaveLength(1)
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
      filterGames(ENTRIES, { ...BASE, stores: ['steam'], onlyInstalled: true }).map((e) => e.name)
    ).toEqual(['Team Fortress 2', 'Far Cry 4'])
  })

  it('ignores surrounding whitespace in the search', () => {
    expect(filterGames(ENTRIES, { ...BASE, search: '  fortnite  ' })).toHaveLength(1)
  })
})

describe('toggleStore', () => {
  it('adds a store that is not selected yet', () => {
    expect(toggleStore([], 'epic')).toEqual(['epic'])
  })

  it('removes a store that is already selected', () => {
    expect(toggleStore(['steam', 'epic'], 'steam')).toEqual(['epic'])
  })

  it('returns to the empty selection when the last store goes', () => {
    // Which is the neutral "all stores" state — see filterGames.
    expect(toggleStore(['epic'], 'epic')).toEqual([])
  })

  it('normalises to the canonical store order, not the click order', () => {
    // So the trigger label reads the same whichever was ticked first.
    expect(toggleStore(['ubisoft'], 'steam')).toEqual(['steam', 'ubisoft'])
  })

  it('does not mutate the input array', () => {
    const stores: StoreId[] = ['steam']
    toggleStore(stores, 'epic')
    expect(stores).toEqual(['steam'])
  })
})

describe('storeFilterLabel', () => {
  it('names the neutral state for an empty selection', () => {
    expect(storeFilterLabel([])).toBe('All stores')
  })

  it('names a single store', () => {
    expect(storeFilterLabel(['steam'])).toBe('Steam')
  })

  it('lists two stores', () => {
    expect(storeFilterLabel(['steam', 'epic'])).toBe('Steam, Epic')
  })

  it('counts from three, where the names would no longer fit the toolbar', () => {
    expect(storeFilterLabel(['steam', 'epic', 'ea'])).toBe('3 stores')
  })
})

describe('storeFilterTitle', () => {
  it('names the neutral state for an empty selection', () => {
    expect(storeFilterTitle([])).toBe('Store: All stores')
  })

  it('lists a selection the label still shows in full', () => {
    expect(storeFilterTitle(['steam', 'epic'])).toBe('Store: Steam, Epic')
  })

  it('spells out the names the label collapses into a count', () => {
    // The point of the tooltip: from three stores on, this is the only
    // place the selection is readable.
    expect(storeFilterTitle(['steam', 'epic', 'ea'])).toBe('Store: Steam, Epic, EA')
  })
})

describe('sortGames', () => {
  const s = (name: string, o: Partial<Game> = {}): LibraryEntry =>
    entry(name, [game('steam', name, name, o)])

  it('sorts by name regardless of case', () => {
    // 'apple' against 'Zebra': a pure code-point sort would put 'Zebra'
    // first.
    expect(sortGames([s('Zebra'), s('apple')], 'name', 'asc').map((e) => e.name)).toEqual([
      'apple',
      'Zebra'
    ])
  })

  it('reverses the name order on descending', () => {
    expect(sortGames([s('apple'), s('Zebra')], 'name', 'desc').map((e) => e.name)).toEqual([
      'Zebra',
      'apple'
    ])
  })

  it('sorts by playtime descending, values-missing last', () => {
    const list = [s('A'), s('B', { playtimeMinutes: 500 }), s('C', { playtimeMinutes: 100 })]
    expect(sortGames(list, 'playtime', 'desc').map((e) => e.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by playtime ascending, values-missing STILL last', () => {
    // The point of the direction toggle: "which have I played least?" —
    // which the games without any playtime would drown out if reversing put
    // them on top.
    const list = [s('A'), s('B', { playtimeMinutes: 500 }), s('C', { playtimeMinutes: 100 })]
    expect(sortGames(list, 'playtime', 'asc').map((e) => e.name)).toEqual(['C', 'B', 'A'])
  })

  it('sorts by last played, values-missing last', () => {
    const list = [s('A'), s('B', { lastPlayed: 100 }), s('C', { lastPlayed: 900 })]
    expect(sortGames(list, 'lastPlayed', 'desc').map((e) => e.name)).toEqual(['C', 'B', 'A'])
  })

  it('sorts by last played ascending, values-missing last', () => {
    const list = [s('A'), s('B', { lastPlayed: 100 }), s('C', { lastPlayed: 900 })]
    expect(sortGames(list, 'lastPlayed', 'asc').map((e) => e.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by size descending', () => {
    const list = [s('A', { installSizeBytes: 100 }), s('B'), s('C', { installSizeBytes: 900 })]
    expect(sortGames(list, 'size', 'desc').map((e) => e.name)).toEqual(['C', 'A', 'B'])
  })

  it('sorts by size ascending, values-missing last', () => {
    const list = [s('A', { installSizeBytes: 100 }), s('B'), s('C', { installSizeBytes: 900 })]
    expect(sortGames(list, 'size', 'asc').map((e) => e.name)).toEqual(['A', 'C', 'B'])
  })

  it('does not mutate the input array', () => {
    const list = [s('zork'), s('Ape')]
    sortGames(list, 'name', 'asc')
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
