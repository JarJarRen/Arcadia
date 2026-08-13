import type { Freebie, FreebieSource, RawFreebie } from '@shared/freebies'
import type { StoreId } from '@shared/types'
import { mergeKey } from '@main/library/merge'

/**
 * The row's identity.
 *
 * Reuses the library's own normalisation, so "Ghostrunner™" from Epic's
 * feed and "Ghostrunner" from the aggregator are one row rather than two.
 */
export function freebieId(storeId: StoreId, title: string): string {
  return `${storeId}:${mergeKey(title)}`
}

/**
 * Which source wins when the same game arrives twice.
 *
 * Native feeds outrank the aggregator because they carry a store
 * identifier — Epic's also carries the exact promotion window, but
 * Steam's `featuredcategories` endpoint carries no window at all, which is
 * why `endsAt`/`startsAt` are merged in field by field below rather than
 * discarded with the rest of a lower-ranked row. Fixed ranking rather than
 * first-wins: otherwise the answer would depend on which request finished
 * first, which is not a property anybody can reason about.
 */
const RANK: Record<FreebieSource, number> = { epic: 0, steam: 1, gamerpower: 2 }

export function dedupeFreebies(rows: RawFreebie[]): RawFreebie[] {
  const groups = new Map<string, RawFreebie[]>()
  for (const row of rows) {
    const id = freebieId(row.storeId, row.title)
    const bucket = groups.get(id)
    if (bucket === undefined) groups.set(id, [row])
    else bucket.push(row)
  }

  const merged: RawFreebie[] = []
  for (const bucket of groups.values()) {
    const ranked = [...bucket].sort((a, b) => RANK[a.source] - RANK[b.source])
    const winner = ranked[0]!
    // The winner's own row still decides everything else — the store
    // identifier, the claim URL, the image. Only the deadline fields are
    // taken from a lower-ranked row, and only where the winner has nothing
    // to say: Steam's row can never carry one, so without this a Steam
    // giveaway deduped against its GamerPower twin would lose the only end
    // date it ever had.
    const startsAt = ranked.find((row) => row.startsAt !== undefined)?.startsAt
    const endsAt = ranked.find((row) => row.endsAt !== undefined)?.endsAt
    merged.push({
      ...winner,
      ...(startsAt === undefined ? {} : { startsAt }),
      ...(endsAt === undefined ? {} : { endsAt })
    })
  }
  return merged
}

export function filterByStores(rows: Freebie[], stores: StoreId[]): Freebie[] {
  const wanted = new Set(stores)
  return rows.filter((row) => wanted.has(row.storeId))
}

/** Absent sorts last: a row with no deadline is never the urgent one. */
function byDate(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a - b
}

export function splitFreebies(
  rows: Freebie[],
  now: number
): { current: Freebie[]; upcoming: Freebie[] } {
  const current: Freebie[] = []
  const upcoming: Freebie[] = []

  for (const row of rows) {
    // Expired is dropped rather than shown greyed out. Evaluated here, on
    // read, so a page held open across the expiry corrects itself without
    // waiting for the cache to be rewritten.
    if (row.endsAt !== undefined && row.endsAt <= now) continue
    if (row.startsAt !== undefined && row.startsAt > now) upcoming.push(row)
    else current.push(row)
  }

  current.sort((a, b) => byDate(a.endsAt, b.endsAt))
  upcoming.sort((a, b) => byDate(a.startsAt, b.startsAt))
  return { current, upcoming }
}
