import type { FreebieKind, RawFreebie } from '@shared/freebies'
import type { StoreId } from '@shared/types'
import type { FetchFn } from '@main/metadata/steamAppList'

// Unfiltered, rather than the platform- or type-filtered variants the API
// also offers: Arcadia already does its own store mapping and kind
// filtering, and the filtered variants would have to be requested once per
// platform to get the same coverage.
const ENDPOINT = 'https://www.gamerpower.com/api/giveaways'

/**
 * The aggregator's platform names, mapped onto Arcadia's stores.
 *
 * The field is a comma-separated string matched by substring, and the first
 * match wins. The table is ordered most-specific-first as a guard against
 * a future entry whose key is a substring of one already here. Anything
 * unmapped — GOG, itch.io, DRM-free — is dropped, because Arcadia can
 * neither deep-link nor confirm it.
 */
const PLATFORMS: ReadonlyArray<[string, StoreId]> = [
  ['epic games store', 'epic'],
  ['steam', 'steam'],
  ['ubisoft', 'ubisoft'],
  ['origin', 'ea'],
  ['ea app', 'ea'],
  ['xbox', 'microsoft'],
  ['microsoft', 'microsoft']
]

function storeOf(platforms: unknown): StoreId | undefined {
  if (typeof platforms !== 'string') return undefined
  const haystack = platforms.toLowerCase()
  for (const [needle, store] of PLATFORMS) {
    if (haystack.includes(needle)) return store
  }
  return undefined
}

function kindOf(type: unknown): FreebieKind {
  if (typeof type !== 'string') return 'loot'
  const value = type.toLowerCase()
  if (value === 'game') return 'game'
  if (value === 'dlc') return 'dlc'
  // Early Access, Other, and anything the feed invents later.
  return 'loot'
}

/**
 * The feed's date format, which is not ISO.
 *
 * "2026-08-20 23:59:00" with no zone. Read as UTC rather than as local
 * time: the alternative is a date that shifts by the developer's own
 * offset, and "ends in 2 days" being wrong by a day is worse than being
 * coarse by hours.
 */
function parseEndDate(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === 'N/A') return undefined
  const parsed = Date.parse(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed) ? undefined : parsed
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Marketing boilerplate the aggregator appends to a title that a native
 * feed reports plainly — "Beacon Pines (Epic Games) Giveaway" against
 * Epic's own "Beacon Pines". Left in place, the two never dedup (see
 * dedupeFreebies, which keys on the title) and the same game shows up
 * twice, once correctly marked owned and once offered as if it were not.
 *
 * Each pattern strips only from the *end*, and only a fixed, known store
 * name in parentheses — never an arbitrary parenthetical, which could be
 * part of the product's own name ("Drop Loot (Playtest)"). Applied
 * repeatedly because the boilerplate stacks: "… Steam Key Giveaway" needs
 * both the trailing "Giveaway" and the trailing "Steam Key" removed, and
 * removing one can expose the other.
 *
 * The word patterns require `\s+` (at least one whitespace character)
 * before the word, not `\s*`. `\s*` also matches zero whitespace, which
 * lets the pattern match inside a word rather than only a standalone word
 * at the boundary — "NHL 24: Hockey" loses its tail to "…key$" and becomes
 * "NHL 24: Hoc". The store-parenthetical pattern keeps `\s*`: the literal
 * "(" it requires is already a hard boundary, so it cannot match inside a
 * word, and a title can legitimately butt up against it with no space
 * ("Beacon Pines(Epic Games)").
 */
const TRAILING_PATTERNS: readonly RegExp[] = [
  /\s+giveaway$/i,
  /\s*\((?:epic games store|epic games|steam|ubisoft|gog|origin|ea app|ea|xbox|microsoft)\)$/i,
  /\s+(?:steam key|epic key|ubisoft key|key)$/i,
  /\s+free game$/i
]

function stripMarketingBoilerplate(title: string): string {
  let stripped = title
  let changed = true
  while (changed) {
    changed = false
    for (const pattern of TRAILING_PATTERNS) {
      const next = stripped.replace(pattern, '')
      if (next !== stripped) {
        stripped = next
        changed = true
      }
    }
  }

  const cleaned = stripped.trim().replace(/\s+/g, ' ')
  // A title that strips down to nothing was never boilerplate to begin
  // with — some other pattern in the table matched too eagerly — so the
  // safer answer is the original title rather than an empty card.
  return cleaned.length === 0 ? title : cleaned
}

export function parseGamerPowerFreebies(json: unknown, now: number): RawFreebie[] {
  if (!Array.isArray(json)) return []

  const rows: RawFreebie[] = []
  for (const entry of json) {
    const record = asRecord(entry)
    if (record.status !== 'Active') continue

    const title = record.title
    if (typeof title !== 'string' || title.length === 0) continue

    const storeId = storeOf(record.platforms)
    if (storeId === undefined) continue

    const url = record.open_giveaway_url
    if (typeof url !== 'string' || url.length === 0) continue

    const endsAt = parseEndDate(record.end_date)
    if (endsAt !== undefined && endsAt <= now) continue

    const image = record.thumbnail
    rows.push({
      storeId,
      title: stripMarketingBoilerplate(title),
      kind: kindOf(record.type),
      claimUrl: url,
      ...(typeof image === 'string' ? { imageUrl: image } : {}),
      ...(endsAt === undefined ? {} : { endsAt }),
      source: 'gamerpower'
    })
  }
  return rows
}

export async function fetchGamerPowerFreebies(options: {
  now: number
  fetchFn?: FetchFn
}): Promise<RawFreebie[]> {
  // The cast is the house pattern — steamAppList, steamStore and
  // steamGridDb all default the same way.
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  const response = await fetchFn(ENDPOINT)
  if (!response.ok) throw new Error(`GamerPower answered ${response.status}`)
  return parseGamerPowerFreebies(await response.json(), options.now)
}
