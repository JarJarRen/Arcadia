import { readFile, writeFile } from 'node:fs/promises'
import type { RawGame } from '@shared/types'
import { t } from '@shared/i18n'

/**
 * Names and numeric IDs for owned EA offers.
 *
 * The entitlement store says *what* is owned but calls everything
 * `Origin.OFR.50.0003794`. Arcadia keys EA games on the numeric master title
 * ID — the registry produces it, and `origin2://game/launch?offerIds=` needs
 * it — so the two have to be joined.
 *
 * Origin's old public API cannot do it any more: every endpoint under
 * `api*.origin.com` now answers HTTP 404 with "Origin has shut down". EA
 * Desktop itself uses a GraphQL service, and the query below is EA's own,
 * lifted from `EABackgroundService.exe`. It needs **no authentication** —
 * measured against all 34 owned offers on the development machine: 34 of 34
 * resolved a master title ID, 32 of 34 a name.
 *
 * That it is undocumented is the risk worth stating: EA can change or close
 * it without notice. A failure here is passed upwards so `sync.ts` records a
 * partial failure, which leaves the installed games alone.
 */

export const EA_CATALOG_ENDPOINT = 'https://service-aggregation-layer.juno.ea.com/graphql'

/**
 * Both halves in one document.
 *
 * `legacyOffers` carries the master title ID, `gameProducts` the readable
 * name and the product type. The `$locale` argument EA passes was dropped:
 * with it the service answers "Graphql validation error", without it both
 * fields return everything needed.
 */
export const EA_CATALOG_QUERY = `query ArcadiaEaCatalog($offerIds: [String!]!) {
  legacyOffers(offerIds: $offerIds) {
    id
    displayName
    primaryMasterTitleId
  }
  gameProducts(offerIds: $offerIds) {
    items {
      name
      originOfferId
      baseItem {
        title
        gameType
      }
    }
  }
}`

/**
 * Offers per request.
 *
 * 34 in one call is fine; the chunk exists so a large library cannot build a
 * request of unbounded size.
 */
const CHUNK_SIZE = 100

export interface EaCatalogEntry {
  offerId: string
  name?: string
  masterTitleId?: string
  gameType?: string
}

export type PostFn = (
  url: string,
  body: string
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const defaultPost: PostFn = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body
  })

/** A string that is actually a string with something in it. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

interface CatalogPayload {
  errors?: unknown
  data?: {
    legacyOffers?: unknown
    gameProducts?: { items?: unknown }
  }
}

/**
 * Folds the two halves of the response into one entry per offer.
 *
 * `displayName` is preferred but is frequently the empty string, so it falls
 * through to the product name and then to the base item's title. Measured,
 * that fallback chain is the difference between 18 and 32 named offers out of
 * 34 — the empty strings are the common case, not the exception.
 */
export function parseCatalogResponse(payload: unknown): EaCatalogEntry[] {
  const body = payload as CatalogPayload | null
  if (body === null || typeof body !== 'object') return []

  const entries = new Map<string, EaCatalogEntry>()

  const offers = body.data?.legacyOffers
  if (Array.isArray(offers)) {
    for (const raw of offers) {
      if (typeof raw !== 'object' || raw === null) continue
      const record = raw as { id?: unknown; displayName?: unknown; primaryMasterTitleId?: unknown }
      const offerId = text(record.id)
      if (offerId === undefined) continue
      const entry: EaCatalogEntry = { offerId }
      const name = text(record.displayName)
      if (name !== undefined) entry.name = name
      // Numbers and numeric strings both occur; both become a string, and
      // anything else is discarded rather than coerced.
      const master = record.primaryMasterTitleId
      const masterText = typeof master === 'number' ? String(master) : text(master)
      if (masterText !== undefined && /^\d+$/.test(masterText)) entry.masterTitleId = masterText
      entries.set(offerId, entry)
    }
  }

  const items = body.data?.gameProducts?.items
  if (Array.isArray(items)) {
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null) continue
      const record = raw as { name?: unknown; originOfferId?: unknown; baseItem?: unknown }
      const offerId = text(record.originOfferId)
      if (offerId === undefined) continue
      const entry = entries.get(offerId) ?? { offerId }
      const base = record.baseItem as { title?: unknown; gameType?: unknown } | null
      if (entry.name === undefined) {
        const name = text(record.name) ?? text(base?.title)
        if (name !== undefined) entry.name = name
      }
      const gameType = text(base?.gameType)
      if (gameType !== undefined) entry.gameType = gameType
      entries.set(offerId, entry)
    }
  }

  return [...entries.values()]
}

/** Asks the catalogue about a set of offers. */
export async function fetchEaCatalog(
  offerIds: string[],
  post: PostFn = defaultPost
): Promise<EaCatalogEntry[]> {
  const entries: EaCatalogEntry[] = []

  for (let start = 0; start < offerIds.length; start += CHUNK_SIZE) {
    const chunk = offerIds.slice(start, start + CHUNK_SIZE)
    const body = JSON.stringify({
      query: EA_CATALOG_QUERY,
      variables: { offerIds: chunk }
    })

    let response: Awaited<ReturnType<PostFn>>
    try {
      response = await post(EA_CATALOG_ENDPOINT, body)
    } catch {
      throw new Error(t().stores.ea.catalogUnreachable)
    }
    if (!response.ok) {
      throw new Error(t().stores.ea.catalogHttpError(response.status))
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(t().stores.ea.catalogUnreadable)
    }

    // A GraphQL error arrives with HTTP 200 and no usable data. Treated as a
    // failure rather than as an empty library, so a broken query cannot look
    // like "you own nothing".
    if ((payload as CatalogPayload | null)?.errors !== undefined) {
      throw new Error(t().stores.ea.catalogUnreadable)
    }

    entries.push(...parseCatalogResponse(payload))
  }

  return entries
}

export interface ResolveDeps {
  post?: PostFn
  cachePath?: string
  readCache?: (path: string) => Promise<string>
  writeCache?: (path: string, contents: string) => Promise<void>
}

function parseCache(contents: string): EaCatalogEntry[] {
  try {
    const parsed: unknown = JSON.parse(contents)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is EaCatalogEntry =>
        typeof entry === 'object' && entry !== null && typeof (entry as EaCatalogEntry).offerId === 'string'
    )
  } catch {
    return []
  }
}

/**
 * Resolves offers, asking the catalogue only about the ones not already known.
 *
 * An offer that resolved to nothing is cached too. Without that, the handful
 * EA classifies as nothing at all would be re-requested on every single scan
 * forever — the same reasoning as `fetch_attempts` in the metadata table. The
 * cost is that a name EA adds later is not picked up until the cache is
 * deleted, which is the better trade for something that changes this rarely.
 */
export async function resolveEaOffers(
  offerIds: string[],
  deps: ResolveDeps = {}
): Promise<EaCatalogEntry[]> {
  const readCache = deps.readCache ?? ((path: string): Promise<string> => readFile(path, 'utf8'))
  const writeCache =
    deps.writeCache ??
    ((path: string, contents: string): Promise<void> => writeFile(path, contents, 'utf8'))

  const cached = new Map<string, EaCatalogEntry>()
  if (deps.cachePath !== undefined) {
    try {
      for (const entry of parseCache(await readCache(deps.cachePath))) {
        cached.set(entry.offerId, entry)
      }
    } catch {
      // No cache yet, or one that cannot be read. Neither is a problem: the
      // catalogue is asked about everything instead.
    }
  }

  const missing = offerIds.filter((offerId) => !cached.has(offerId))
  if (missing.length > 0) {
    for (const entry of await fetchEaCatalog(missing, deps.post)) {
      cached.set(entry.offerId, entry)
    }
    // Every offer that was asked about counts as known, including the ones
    // the answer did not mention at all.
    for (const offerId of missing) {
      if (!cached.has(offerId)) cached.set(offerId, { offerId })
    }

    if (deps.cachePath !== undefined) {
      try {
        await writeCache(deps.cachePath, JSON.stringify([...cached.values()]))
      } catch {
        // A cache that cannot be written is no reason to discard what was
        // just fetched.
      }
    }
  }

  return offerIds.map((offerId) => cached.get(offerId) ?? { offerId })
}

/** What EA classifies as an actual game rather than content for one. */
const BASE_GAME = 'BASE_GAME'

/**
 * Trials and demos, recognised by name.
 *
 * They come back as `BASE_GAME` like anything else — "EA SPORTS FC 26
 * SHOWCASE" and "EA SPORTS FIFA 20 Demo" both do. Where one shares a master
 * title ID with the full game, the full game wins; where a trial is the only
 * thing owned under that ID, it is still the honest answer and stays.
 */
const TRIAL = /\b(trial|demo|showcase|beta|preview)\b/i

/**
 * Turns catalogue entries into games.
 *
 * Three steps, in order. Keep only base games — points packs and pre-order
 * content are not games. Require a name, because "Unknown game (413150)" is
 * worse than nothing, which is the same rule the Steam adapter and the
 * launcher log already follow. Then collapse offers that share a master title
 * ID: EA SPORTS FC 26 is owned four times over as an edition, a trial and two
 * content packs, and it is one game.
 */
export function toOwnedGames(entries: EaCatalogEntry[]): RawGame[] {
  const chosen = new Map<string, EaCatalogEntry>()

  for (const entry of entries) {
    if (entry.gameType !== BASE_GAME) continue
    if (entry.name === undefined || entry.masterTitleId === undefined) continue

    const existing = chosen.get(entry.masterTitleId)
    if (existing === undefined) {
      chosen.set(entry.masterTitleId, entry)
      continue
    }
    // A non-trial replaces a trial; nothing else replaces anything, so the
    // first offer of equal standing keeps the place.
    if (TRIAL.test(existing.name ?? '') && !TRIAL.test(entry.name)) {
      chosen.set(entry.masterTitleId, entry)
    }
  }

  return [...chosen.entries()].map(([masterTitleId, entry]) => ({
    storeGameId: masterTitleId,
    name: entry.name as string,
    // What is installed is decided by the registry scan alone.
    installed: false
  }))
}
