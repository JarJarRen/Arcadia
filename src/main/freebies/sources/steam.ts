import type { RawFreebie } from '@shared/freebies'
import type { FetchFn } from '@main/metadata/steamAppList'

const ENDPOINT = 'https://store.steampowered.com/api/featuredcategories'

export interface SteamFreebieOptions {
  country: string
  language: string
  fetchFn?: FetchFn
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function parseSteamFreebies(json: unknown): RawFreebie[] {
  const items = asArray(asRecord(asRecord(json).specials).items)

  const rows: RawFreebie[] = []
  for (const item of items) {
    const record = asRecord(item)
    // 100% off is the whole promotion. A sale is not a giveaway.
    if (record.discount_percent !== 100) continue

    const title = record.name
    if (typeof title !== 'string' || title.length === 0) continue

    // The AppID reaches steam:// and must be digits and nothing else.
    // Refused here as well as in claim.ts: a row that could never produce
    // a valid URI has no business being cached in the first place.
    if (typeof record.id !== 'number' || !Number.isInteger(record.id) || record.id <= 0) continue

    const image = record.header_image
    rows.push({
      storeId: 'steam',
      title,
      kind: 'game',
      storeGameId: String(record.id),
      ...(typeof image === 'string' ? { imageUrl: image } : {}),
      source: 'steam'
    })
  }
  return rows
}

export async function fetchSteamFreebies(options: SteamFreebieOptions): Promise<RawFreebie[]> {
  // The cast is the house pattern — steamAppList, steamStore and
  // steamGridDb all default the same way.
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  const url = `${ENDPOINT}?cc=${encodeURIComponent(options.country)}&l=${encodeURIComponent(options.language)}`
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`Steam answered ${response.status}`)
  return parseSteamFreebies(await response.json())
}
