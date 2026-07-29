import type { ArtworkRef } from '@shared/metadata'
import { normalizeTitle } from './steamAppList'

const BASE = 'https://www.steamgriddb.com/api/v2'

/**
 * The response carries **no** `x-ratelimit` header — checked on the
 * development machine. Without any word on the permitted rate, pausing is
 * conservative. Across 17 gaps that costs about ten seconds in total.
 */
export const SGDB_PAUSE_MS = 600

export type SgdbFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface SgdbOptions {
  apiKey: string
  fetchFn?: SgdbFetch
}

interface SgdbGame {
  id?: unknown
  name?: unknown
}

interface SgdbImage {
  url?: unknown
}

/**
 * A single call against the API.
 *
 * Returns `undefined` on every failure rather than throwing: none of the
 * call sites could do more with an error than swallow it — a missing image
 * is no reason to abort anything.
 *
 * The original exception is discarded on purpose. It can carry the full URL
 * including the key and would otherwise reach the log.
 */
async function request(
  path: string,
  options: SgdbOptions
): Promise<Record<string, unknown> | undefined> {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as SgdbFetch)
  try {
    const response = await fetchFn(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${options.apiKey}` }
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as Record<string, unknown> | null
    return body ?? undefined
  } catch {
    return undefined
  }
}

/** The SteamGridDB identifier for a Steam AppID. */
export async function lookupBySteamAppId(
  appId: number,
  options: SgdbOptions
): Promise<number | undefined> {
  const body = await request(`/games/steam/${appId}`, options)
  const data = body?.data as SgdbGame | undefined
  return typeof data?.id === 'number' ? data.id : undefined
}

/**
 * Searches by name — and accepts the hit **only on an exact match**.
 *
 * The reason is measured, not feared: searching for "EA SPORTS(tm) FIFA 23"
 * returns "EA Sports FIFA 21" as the best hit. HTTP 200, ten results,
 * nothing suggesting a mistake. Taking the first hit hangs FIFA 21's
 * packshot over FIFA 23 — and unlike a missing image, a wrong one goes
 * unnoticed.
 *
 * The same trade-off as in the Steam name matching: a wrong match is worse
 * than a missing one. For the rejected cases there is manual matching.
 */
export async function searchExact(
  name: string,
  options: SgdbOptions
): Promise<number | undefined> {
  const wanted = normalizeTitle(name)
  if (wanted === '') return undefined

  const body = await request(`/search/autocomplete/${encodeURIComponent(name)}`, options)
  const hits = Array.isArray(body?.data) ? (body.data as SgdbGame[]) : []

  for (const candidate of hits) {
    if (typeof candidate?.name !== 'string' || typeof candidate.id !== 'number') continue
    if (normalizeTitle(candidate.name) === wanted) return candidate.id
  }
  return undefined
}

/**
 * Fetches grid and hero artwork for a SteamGridDB identifier.
 *
 * The sizes are chosen from measurement: heroes come in 3840x1240 and
 * 1920x620. The smaller one is plenty for a 260-pixel header and is a
 * quarter of the data.
 *
 * `types=static` excludes animated grids — they are markedly larger and,
 * in a grid of 200 tiles, more distracting than pretty.
 */
export async function fetchArtwork(
  sgdbId: number,
  options: SgdbOptions
): Promise<ArtworkRef[]> {
  const queries: { kind: ArtworkRef['kind']; path: string }[] = [
    { kind: 'grid', path: `/grids/game/${sgdbId}?dimensions=600x900&types=static` },
    { kind: 'hero', path: `/heroes/game/${sgdbId}?dimensions=1920x620&types=static` }
  ]

  const found: ArtworkRef[] = []
  for (const query of queries) {
    const body = await request(query.path, options)
    const list = Array.isArray(body?.data) ? (body.data as SgdbImage[]) : []
    // The first entry is the highest rated one.
    const first = list.find((image) => typeof image?.url === 'string' && image.url !== '')
    if (first === undefined) continue

    const url = first.url as string
    // https only: the CSP permits nothing else, and an http image would be
    // blocked silently, leaving an empty tile.
    if (!url.startsWith('https://')) continue
    found.push({ kind: query.kind, url })
  }
  return found
}
