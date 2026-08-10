import type { RawFreebie } from '@shared/freebies'
import type { FetchFn } from '@main/metadata/steamAppList'

/**
 * Epic's own promotions feed. Public, no key, no sign-in.
 *
 * `country` decides which promotions apply — a giveaway can be regional —
 * and `locale` decides the language of the titles.
 */
const ENDPOINT = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions'

/** Where a game with no page slug has to send the user instead. */
const STORE_FALLBACK = 'https://store.epicgames.com/'

export interface EpicFreebieOptions {
  locale: string
  country: string
  now: number
  fetchFn?: FetchFn
}

interface Offer {
  startDate?: unknown
  endDate?: unknown
  discountSetting?: { discountPercentage?: unknown }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function parseDate(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * The first offer that costs nothing.
 *
 * Epic nests this twice: `promotions.promotionalOffers` is a list of
 * groups, each of which holds its own `promotionalOffers` list. Flattening
 * one level too few finds nothing at all.
 */
function freeOffer(groups: unknown): Offer | undefined {
  for (const group of asArray(groups)) {
    for (const offer of asArray(asRecord(group).promotionalOffers)) {
      const record = asRecord(offer)
      const setting = asRecord(record.discountSetting)
      // Epic's spelling of "pays nothing" is a percentage of 0 — the price
      // the buyer is charged, not the size of the reduction.
      if (setting.discountPercentage === 0) return record as Offer
    }
  }
  return undefined
}

function imageUrl(keyImages: unknown): string | undefined {
  const images = asArray(keyImages).map(asRecord)
  // Wide first: it is the only one guaranteed to be a landscape crop, which
  // is the shape the card reserves space for.
  const wide = images.find((image) => image.type === 'OfferImageWide')
  const any = wide ?? images[0]
  return typeof any?.url === 'string' ? any.url : undefined
}

function pageSlug(catalogNs: unknown): string | undefined {
  for (const mapping of asArray(asRecord(catalogNs).mappings)) {
    const slug = asRecord(mapping).pageSlug
    if (typeof slug === 'string' && slug.length > 0) return slug
  }
  return undefined
}

export function parseEpicFreebies(json: unknown, now: number): RawFreebie[] {
  const elements = asArray(
    asRecord(asRecord(asRecord(asRecord(json).data).Catalog).searchStore).elements
  )

  const rows: RawFreebie[] = []
  for (const element of elements) {
    const record = asRecord(element)
    const title = record.title
    if (typeof title !== 'string' || title.length === 0) continue

    const promotions = asRecord(record.promotions)
    const offer =
      freeOffer(promotions.promotionalOffers) ?? freeOffer(promotions.upcomingPromotionalOffers)
    if (offer === undefined) continue

    const endsAt = parseDate(offer.endDate)
    // An offer whose window has already closed is not news. The cache is
    // rewritten on refresh, but a stale response must not resurrect one.
    if (endsAt !== undefined && endsAt <= now) continue

    const slug = pageSlug(record.catalogNs)
    const image = imageUrl(record.keyImages)
    const startsAt = parseDate(offer.startDate)
    rows.push({
      storeId: 'epic',
      title,
      kind: 'game',
      ...(slug === undefined ? { claimUrl: STORE_FALLBACK } : { storeGameId: slug }),
      ...(image === undefined ? {} : { imageUrl: image }),
      ...(startsAt === undefined ? {} : { startsAt }),
      ...(endsAt === undefined ? {} : { endsAt }),
      source: 'epic'
    })
  }
  return rows
}

export async function fetchEpicFreebies(options: EpicFreebieOptions): Promise<RawFreebie[]> {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  const url = `${ENDPOINT}?locale=${encodeURIComponent(options.locale)}&country=${encodeURIComponent(options.country)}&allowCountries=${encodeURIComponent(options.country)}`
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`Epic answered ${response.status}`)
  return parseEpicFreebies(await response.json(), options.now)
}
