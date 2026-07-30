import type { GameMetadata } from '@shared/metadata'
import { getLanguage } from '@shared/i18n'
import type { FetchFn } from './steamAppList'

/**
 * The store API of the Steam website. No API key required.
 *
 * The `l=` parameter decides the language of description, genres and
 * release date — verified on the development machine, where `l=german`
 * returned "Rollenspiel" and "9. Dez. 2020".
 */
const ENDPOINT = 'https://store.steampowered.com/api/appdetails'

/** Steam's spelling of the languages this app knows. */
const STEAM_LANGUAGE: Record<string, string> = {
  en: 'english',
  de: 'german'
}

export type SteamStoreErrorKind = 'rate-limited' | 'network' | 'unexpected'

export class SteamStoreError extends Error {
  constructor(
    readonly kind: SteamStoreErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'SteamStoreError'
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' '
}

/**
 * Strips HTML out of the descriptions.
 *
 * The store API returns markup. It is stripped on **read**, not on display:
 * that way no unvetted markup ever reaches the renderer, and the details
 * page can simply set the text as text.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

export interface AppDetailsOptions {
  fetchFn?: FetchFn
  language?: string
}

interface StoreData {
  type?: unknown
  name?: unknown
  short_description?: unknown
  detailed_description?: unknown
  developers?: unknown
  publishers?: unknown
  genres?: unknown
  release_date?: unknown
  metacritic?: unknown
  screenshots?: unknown
  header_image?: unknown
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/**
 * Fetches the store data for an AppID.
 *
 * Returns `undefined` when Steam does not know the entry or it is not a
 * game — both are expected states, not errors. It throws only on network or
 * structural problems, and HTTP 429 gets a kind of its own so the queue can
 * back off instead of writing the game off as unfindable.
 *
 * The language follows the app's active language. Metadata already stored
 * keeps whatever language it was fetched in; only new fetches change.
 */
export async function fetchAppDetails(
  appId: number,
  options: AppDetailsOptions = {}
): Promise<GameMetadata | undefined> {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  const language = options.language ?? STEAM_LANGUAGE[getLanguage()] ?? 'english'
  const url = `${ENDPOINT}?appids=${appId}&l=${language}`

  let response
  try {
    response = await fetchFn(url)
  } catch {
    throw new SteamStoreError('network', 'The Steam store is unreachable.')
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new SteamStoreError('rate-limited', 'The Steam store is throttling requests.')
    }
    throw new SteamStoreError(
      'unexpected',
      `The Steam store answered with HTTP ${response.status}.`
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SteamStoreError('unexpected', 'The Steam store did not return valid JSON.')
  }

  // JSON.parse('null') does not throw — reaching for a property would then
  // produce a bare TypeError instead of a SteamStoreError.
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new SteamStoreError('unexpected', 'The Steam store returned an unexpected shape.')
  }

  const entry = (payload as Record<string, unknown>)[String(appId)]
  if (typeof entry !== 'object' || entry === null) return undefined

  const { success, data } = entry as { success?: unknown; data?: unknown }
  if (success !== true || typeof data !== 'object' || data === null) return undefined

  const d = data as StoreData

  // Real games only. Name matching can point at a DLC of the same name —
  // the details page would then carry that DLC's description.
  if (d.type !== 'game') return undefined

  const genres = Array.isArray(d.genres)
    ? d.genres
        .map((g) => (typeof g === 'object' && g !== null ? (g as { description?: unknown }).description : undefined))
        .filter((g): g is string => typeof g === 'string')
    : []

  const screenshots = Array.isArray(d.screenshots)
    ? d.screenshots
        .map((s) => (typeof s === 'object' && s !== null ? (s as { path_full?: unknown }).path_full : undefined))
        .filter((s): s is string => typeof s === 'string')
    : []

  const meta: GameMetadata = {
    steamAppId: appId,
    developers: strings(d.developers),
    publishers: strings(d.publishers),
    genres,
    screenshots,
    fetchAttempts: 0
  }

  if (typeof d.short_description === 'string') {
    meta.shortDescription = stripHtml(d.short_description)
  }
  if (typeof d.detailed_description === 'string') {
    meta.description = stripHtml(d.detailed_description)
  }
  // The one asset URL that cannot be built from the AppID. Kept verbatim,
  // cache-busting query and all: it is what Steam's own store page loads.
  if (typeof d.header_image === 'string' && d.header_image !== '') {
    meta.headerImage = d.header_image
  }

  const release = d.release_date
  if (typeof release === 'object' && release !== null) {
    const date = (release as { date?: unknown }).date
    if (typeof date === 'string' && date !== '') meta.releaseDate = date
  }

  const metacritic = d.metacritic
  if (typeof metacritic === 'object' && metacritic !== null) {
    const score = (metacritic as { score?: unknown }).score
    if (typeof score === 'number') meta.metacritic = score
  }

  return meta
}
