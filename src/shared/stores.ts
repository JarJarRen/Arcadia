import { STORE_IDS, type StoreId } from './types'

/**
 * The stores Arcadia scans and shows, read from the `enabled-stores` setting.
 *
 * Three states, and two of them are easy to confuse:
 *
 * | Value          | Meaning                    |
 * |----------------|----------------------------|
 * | `undefined`    | every store — the default  |
 * | `'steam,epic'` | those two, and no others   |
 * | `''`           | no store at all            |
 *
 * An absent row is what every installation has before this setting existed,
 * so an update must not change anybody's library. An empty string is a real
 * choice and must not collapse into "everything" — the inverse of how the
 * store *filter* works, where the empty selection is the neutral one.
 *
 * Unrecognised ids are dropped rather than rejected: a store added in a later
 * version and read back by an earlier one should leave a usable setting
 * behind, not an unreadable one.
 */
export function parseEnabledStores(value: string | undefined): StoreId[] {
  if (value === undefined) return [...STORE_IDS]
  const wanted = new Set(value.split(',').map((part) => part.trim()))
  // Filtering STORE_IDS rather than mapping the input is what puts the
  // result in the canonical order regardless of how it was stored.
  return STORE_IDS.filter((id) => wanted.has(id))
}

export function serializeEnabledStores(stores: StoreId[]): string {
  return STORE_IDS.filter((id) => stores.includes(id)).join(',')
}
