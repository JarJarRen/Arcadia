import type { FreebieKind, RawFreebie } from '@shared/freebies'
import type { StoreId } from '@shared/types'
import type { FetchFn } from '@main/metadata/steamAppList'

const ENDPOINT = 'https://www.gamerpower.com/api/giveaways'

/**
 * The aggregator's platform names, mapped onto Arcadia's stores.
 *
 * Order matters: the field is a comma-separated string and "Epic Games
 * Store" contains no other key, but a longer name must be tested before a
 * shorter one it contains. Anything unmapped — GOG, itch.io, DRM-free — is
 * dropped, because Arcadia can neither deep-link nor confirm it.
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
      title,
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
