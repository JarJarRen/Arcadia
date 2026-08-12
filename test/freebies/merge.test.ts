/**
 * What turns three source lists into one page.
 *
 * Epic legitimately arrives twice — from its own feed and from the
 * aggregator — and the two rows are not equally good. The native one
 * carries the page slug that makes a deep link possible; the aggregator's
 * carries a redirect URL. Precedence is by source, not by arrival order,
 * so a slow response cannot change the result.
 */
import { describe, expect, it } from 'vitest'
import type { Freebie, RawFreebie } from '@shared/freebies'
import {
  dedupeFreebies,
  filterByStores,
  freebieId,
  splitFreebies
} from '@main/freebies/merge'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

const epicNative: RawFreebie = {
  storeId: 'epic',
  title: 'Ghostrunner™',
  kind: 'game',
  storeGameId: 'ghostrunner',
  source: 'epic'
}

const epicAggregated: RawFreebie = {
  storeId: 'epic',
  title: 'Ghostrunner',
  kind: 'game',
  claimUrl: 'https://www.gamerpower.com/open/ghostrunner',
  source: 'gamerpower'
}

function freebie(overrides: Partial<Freebie>): Freebie {
  return {
    id: 'steam:test',
    storeId: 'steam',
    title: 'Test',
    kind: 'game',
    source: 'steam',
    claim: 'unclaimed',
    ...overrides
  }
}

describe('freebieId', () => {
  it('is stable across the trademark noise that separates two spellings', () => {
    // The same normalisation the library already uses to decide that two
    // entries are one game.
    expect(freebieId('epic', 'Ghostrunner™')).toBe(freebieId('epic', 'Ghostrunner'))
  })

  it('keeps the same title in two stores apart', () => {
    expect(freebieId('epic', 'Ghostrunner')).not.toBe(freebieId('steam', 'Ghostrunner'))
  })
})

describe('dedupeFreebies', () => {
  it('keeps the native row when the aggregator repeats it', () => {
    const rows = dedupeFreebies([epicAggregated, epicNative])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('epic')
    expect(rows[0]?.storeGameId).toBe('ghostrunner')
  })

  it('gives the same answer whichever order the sources answered in', () => {
    const one = dedupeFreebies([epicAggregated, epicNative])
    const other = dedupeFreebies([epicNative, epicAggregated])
    expect(one).toEqual(other)
  })

  it('leaves two different games alone', () => {
    const rows = dedupeFreebies([epicNative, { ...epicNative, title: 'Something Else' }])
    expect(rows).toHaveLength(2)
  })

  it('keeps a Steam row deduped against its GamerPower twin with the twin\'s end date', () => {
    // Steam's own endpoint never reports a window at all, so the only
    // endsAt this pairing can ever have comes from the aggregator's row —
    // discarding it along with the rest of the lower-ranked row would
    // leave the card with no deadline for a promotion that is typically
    // the shortest-lived on the page.
    const steamNative: RawFreebie = {
      storeId: 'steam',
      title: 'Free Forever Game',
      kind: 'game',
      storeGameId: '1145360',
      source: 'steam'
    }
    const steamAggregated: RawFreebie = {
      storeId: 'steam',
      title: 'Free Forever Game',
      kind: 'game',
      claimUrl: 'https://www.gamerpower.com/open/free-forever-game',
      endsAt: NOW + 2 * 86_400_000,
      source: 'gamerpower'
    }
    const rows = dedupeFreebies([steamAggregated, steamNative])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('steam')
    expect(rows[0]?.storeGameId).toBe('1145360')
    expect(rows[0]?.endsAt).toBe(NOW + 2 * 86_400_000)
  })

  it('dedups Epic\'s own row against GamerPower\'s once the boilerplate is stripped', () => {
    // The exact regression: GamerPower's parser now strips "(Epic Games)
    // Giveaway" at parse time (see gamerpower.ts), so both rows carry the
    // plain title "Beacon Pines" by the time they reach dedup. Before that
    // fix the two titles never matched and the game appeared twice — once
    // correctly marked owned, once offered as if it were not.
    const beaconPinesNative: RawFreebie = {
      storeId: 'epic',
      title: 'Beacon Pines',
      kind: 'game',
      storeGameId: 'beacon-pines',
      source: 'epic'
    }
    const beaconPinesAggregated: RawFreebie = {
      storeId: 'epic',
      title: 'Beacon Pines',
      kind: 'game',
      claimUrl: 'https://www.gamerpower.com/open/beacon-pines',
      source: 'gamerpower'
    }
    const rows = dedupeFreebies([beaconPinesAggregated, beaconPinesNative])
    expect(rows).toHaveLength(1)
    // The survivor is the Epic-native row: it carries storeGameId, so the
    // card offers the launcher deep link rather than a browser link.
    expect(rows[0]?.source).toBe('epic')
    expect(rows[0]?.storeGameId).toBe('beacon-pines')
  })

  it('does not let a lower-ranked row overwrite a field the winner already has', () => {
    const higher: RawFreebie = {
      storeId: 'epic',
      title: 'Ghostrunner',
      kind: 'game',
      storeGameId: 'ghostrunner',
      endsAt: NOW + 1_000,
      source: 'epic'
    }
    const lower: RawFreebie = {
      storeId: 'epic',
      title: 'Ghostrunner',
      kind: 'game',
      claimUrl: 'https://www.gamerpower.com/open/ghostrunner',
      endsAt: NOW + 999_999,
      source: 'gamerpower'
    }
    const rows = dedupeFreebies([lower, higher])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.endsAt).toBe(NOW + 1_000)
  })
})

describe('splitFreebies', () => {
  it('files a promotion that has not started as upcoming', () => {
    const later = freebie({ id: 'a', startsAt: NOW + 86_400_000 })
    const { current, upcoming } = splitFreebies([later], NOW)
    expect(upcoming).toEqual([later])
    expect(current).toEqual([])
  })

  it('files a running promotion as current', () => {
    const running = freebie({ id: 'b', startsAt: NOW - 1000, endsAt: NOW + 86_400_000 })
    const { current, upcoming } = splitFreebies([running], NOW)
    expect(current).toEqual([running])
    expect(upcoming).toEqual([])
  })

  it('drops a promotion that has already ended', () => {
    // Evaluated on read, not on write: a page left open overnight must not
    // keep offering a dead promotion until the next refresh.
    const over = freebie({ id: 'c', endsAt: NOW - 1000 })
    const { current, upcoming } = splitFreebies([over], NOW)
    expect(current).toEqual([])
    expect(upcoming).toEqual([])
  })

  it('treats a row with no dates at all as current', () => {
    // Steam reports no window. Absent is not expired.
    const undated = freebie({ id: 'd' })
    expect(splitFreebies([undated], NOW).current).toEqual([undated])
  })

  it('sorts current by what expires first and upcoming by what starts first', () => {
    const soon = freebie({ id: 'soon', endsAt: NOW + 1000 })
    const later = freebie({ id: 'later', endsAt: NOW + 100_000 })
    const undated = freebie({ id: 'undated' })
    const { current } = splitFreebies([later, undated, soon], NOW)
    // A row with no end date sorts last: nothing about it is urgent.
    expect(current.map((row) => row.id)).toEqual(['soon', 'later', 'undated'])

    const first = freebie({ id: 'first', startsAt: NOW + 1000 })
    const second = freebie({ id: 'second', startsAt: NOW + 5000 })
    const { upcoming } = splitFreebies([second, first], NOW)
    expect(upcoming.map((row) => row.id)).toEqual(['first', 'second'])
  })

  it('maintains stable order when two rows have no deadline', () => {
    // Two rows with no deadline are equally un-urgent, so neither should
    // be promoted over the other.
    const first = freebie({ id: 'first' })
    const second = freebie({ id: 'second' })
    const { current } = splitFreebies([first, second], NOW)
    expect(current).toHaveLength(2)
    expect(current[0]?.id).toBe('first')
    expect(current[1]?.id).toBe('second')
  })
})

describe('filterByStores', () => {
  it('keeps only the stores that are switched on', () => {
    const rows = [freebie({ id: 'a', storeId: 'steam' }), freebie({ id: 'b', storeId: 'epic' })]
    expect(filterByStores(rows, ['steam']).map((row) => row.id)).toEqual(['a'])
  })

  it('shows nothing when no store is switched on', () => {
    // An empty selection is a real choice here, exactly as it is for the
    // enabled-stores setting — not a neutral "everything".
    expect(filterByStores([freebie({ id: 'a' })], [])).toEqual([])
  })
})
