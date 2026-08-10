import type { StoreId } from './types'

/**
 * Prefix of a generated store identifier.
 *
 * Deliberately recognisable: whether an identifier is real or generated
 * decides whether the Play and Install buttons appear at all. A generated
 * one cannot be turned into a launch URI, because no store knows it.
 */
const SYNTHETIC_PREFIX = 'manual-'

/**
 * The shape each store's identifiers actually take.
 *
 * Taken from the adapters rather than invented here: Steam, EA and Ubisoft
 * use numbers, Epic uses hex identifiers or names like `UE_5.7`. Checking
 * at the point of entry means a hand-typed value is rejected while the user
 * is still looking at the field, instead of failing later inside
 * `launchUri` where the message would be about a URI they never saw.
 */
const PATTERNS: Record<StoreId, RegExp> = {
  steam: /^\d+$/,
  ea: /^\d+$/,
  ubisoft: /^\d+$/,
  epic: /^[A-Za-z0-9_.-]+$/,
  // Package family name: `<name>_<publisherId>`, the same shape
  // packages.ts derives from the registry. MSIX allows only
  // alphanumerics, periods and dashes in the name half; the publisher ID
  // half is always alphanumeric.
  microsoft: /^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/
}

export function storeGameIdLooksValid(storeId: StoreId, storeGameId: string): boolean {
  return PATTERNS[storeId].test(storeGameId)
}

/**
 * A stable identifier for a game added by hand without a store identifier.
 *
 * Derived from the name rather than random, so the row stays readable in
 * the database and the same entry keeps its identity across restarts —
 * favourites, manual matches and the merge key all hang off it.
 *
 * The cost of that choice: renaming an entry would change its identity and
 * orphan those. There is no rename today; if one arrives, this has to
 * become a stored random value.
 */
export function manualStoreGameId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // A name of pure punctuation would otherwise collapse to the bare prefix
  // and collide with every other such name. Falling back to the character
  // codes keeps it distinct and still deterministic.
  if (slug === '') {
    const codes = [...name.trim()].map((c) => c.codePointAt(0)?.toString(16) ?? '').join('')
    return `${SYNTHETIC_PREFIX}${codes === '' ? 'unnamed' : codes}`
  }

  return `${SYNTHETIC_PREFIX}${slug}`
}

export function isSyntheticId(storeGameId: string): boolean {
  return storeGameId.startsWith(SYNTHETIC_PREFIX)
}
