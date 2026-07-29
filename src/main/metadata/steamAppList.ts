import { readFile, writeFile } from 'node:fs/promises'
import { t } from '@shared/i18n'

export type FetchFn = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export interface SteamApp {
  appid: number
  name: string
}

/**
 * The endpoint from the spec (`ISteamApps/GetAppList`) no longer exists —
 * it answers with HTTP 404 in every version, saying "Method 'GetAppList'
 * not found in interface 'ISteamApps'". Measured on the development
 * machine.
 *
 * The replacement needs an API key and pages its results: 176,253 apps in
 * 8.5 seconds across 4 pages, 7.6 MB on disk.
 */
const ENDPOINT = 'https://api.steampowered.com/IStoreService/GetAppList/v1/'
const PAGE_SIZE = 50_000

/**
 * Upper bound against an endpoint that reports `have_more_results` forever.
 * At 50,000 entries per page, 50 pages cover 2.5 million apps — many times
 * what Steam carries.
 */
const MAX_PAGES = 50

/**
 * Normalises a game title for matching.
 *
 * The question mark is treated like a trademark symbol: Epic's catalogue
 * contains a literal `?` (character 63) in places where ® originally stood
 * — in "RollerCoaster Tycoon? 3", for instance. Without that handling the
 * matching would fail for those titles for no good reason.
 *
 * Deliberately **no** stripping of edition suffixes: "Far Cry 4" and
 * "Far Cry 4 Gold Edition" are different products, and a wrong match is
 * worse than a missing one.
 */
export function normalizeTitle(name: string): string {
  return name
    .replace(/[™®©?]/g, '')
    .toLowerCase()
    .replace(/[:\-–—_,.'’`!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Builds the name index.
 *
 * On duplicate names the first entry wins. Steam lists the same title more
 * than once — as a demo, a soundtrack or a tool — and in practice the main
 * product comes first.
 */
export function buildIndex(apps: SteamApp[]): Map<string, SteamApp> {
  const index = new Map<string, SteamApp>()
  for (const app of apps) {
    if (typeof app?.name !== 'string' || typeof app.appid !== 'number') continue
    const key = normalizeTitle(app.name)
    if (key === '' || index.has(key)) continue
    index.set(key, app)
  }
  return index
}

/**
 * Suggestions for manual matching.
 *
 * The index keeps the original name alongside, not just the AppID. The ID
 * alone would be enough for matching — but a suggestion has to be readable,
 * and normalised names are not ("far cry 4 gold edition").
 *
 * Ranking: exact match, then prefix, then contained anywhere. On a tie the
 * shorter name first — someone searching for "Portal" means "Portal" rather
 * than "Portal 2 Soundtrack", and across 176,000 apps every partial match
 * otherwise drags in hundreds of side products.
 */
export function searchApps(
  apps: Iterable<SteamApp>,
  query: string,
  limit = 20
): SteamApp[] {
  const wanted = normalizeTitle(query)
  if (wanted === '') return []

  const hits: { app: SteamApp; rank: number }[] = []
  for (const app of apps) {
    if (typeof app?.name !== 'string' || typeof app.appid !== 'number') continue
    const name = normalizeTitle(app.name)
    const rank = name === wanted ? 0 : name.startsWith(wanted) ? 1 : name.includes(wanted) ? 2 : -1
    if (rank >= 0) hits.push({ app, rank })
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.app.name.length - b.app.name.length ||
      a.app.name.localeCompare(b.app.name, t().format.locale)
  )
  return hits.slice(0, limit).map((hit) => hit.app)
}

export interface FetchAppListOptions {
  apiKey: string
  fetchFn?: FetchFn
}

interface AppListResponse {
  response?: {
    apps?: unknown
    have_more_results?: unknown
    last_appid?: unknown
  }
}

export async function fetchAppList(options: FetchAppListOptions): Promise<SteamApp[]> {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  const apps: SteamApp[] = []
  let lastAppId = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${ENDPOINT}?key=${encodeURIComponent(options.apiKey)}` +
      `&include_games=true&max_results=${PAGE_SIZE}&last_appid=${lastAppId}`

    let response
    try {
      response = await fetchFn(url)
    } catch {
      // The original message is discarded: it can contain the full URL
      // including the key and would otherwise reach the log.
      throw new Error('Steam app list is unreachable.')
    }

    if (!response.ok) {
      // Half a list would be worse than none — matching would then silently
      // fail to find games, with no discernible reason.
      throw new Error(`Steam app list answered with HTTP ${response.status}.`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error('Steam app list did not return valid JSON.')
    }

    const container = (payload as AppListResponse | null)?.response
    if (typeof container !== 'object' || container === null || !Array.isArray(container.apps)) {
      throw new Error('Steam app list has an unexpected shape.')
    }

    for (const raw of container.apps as SteamApp[]) {
      if (typeof raw?.appid === 'number' && typeof raw.name === 'string') {
        apps.push({ appid: raw.appid, name: raw.name })
      }
    }

    if (container.have_more_results !== true) break
    if (typeof container.last_appid !== 'number') break
    lastAppId = container.last_appid
  }

  return apps
}

/**
 * The app list, cached on disk.
 *
 * A stale cache beats no cache: if the refresh fails, the old one carries
 * on being used and is retried on the next start. Without a list there
 * would be no metadata at all for non-Steam games.
 */
export class SteamAppList {
  private index = new Map<string, SteamApp>()

  /**
   * Reverse lookup AppID → name, built on first use.
   *
   * Not maintained all the time: it is only needed for the games from
   * `localconfig.vdf`, which on the development machine means 45 lookups
   * against 176,000 entries. Building the map once costs less than keeping
   * the list twice.
   */
  private byId: Map<number, string> | undefined

  get size(): number {
    return this.index.size
  }

  findAppId(name: string): number | undefined {
    return this.index.get(normalizeTitle(name))?.appid
  }

  /** The name for an AppID; undefined when Steam does not list it as a game. */
  nameFor(appId: number): string | undefined {
    if (this.byId === undefined) {
      this.byId = new Map()
      for (const app of this.index.values()) this.byId.set(app.appid, app.name)
    }
    return this.byId.get(appId)
  }

  /** Suggestions for manual matching; empty while nothing is loaded. */
  search(query: string, limit?: number): SteamApp[] {
    return searchApps(this.index.values(), query, limit)
  }

  /** Loads from the cache; returns whether that worked. */
  async loadCache(path: string): Promise<boolean> {
    try {
      const apps = JSON.parse(await readFile(path, 'utf8')) as SteamApp[]
      if (!Array.isArray(apps) || apps.length === 0) return false
      this.index = buildIndex(apps)
      this.byId = undefined
      return true
    } catch {
      return false
    }
  }

  /** Fetches the list afresh and writes the cache. */
  async refresh(path: string, options: FetchAppListOptions): Promise<number> {
    const apps = await fetchAppList(options)
    this.index = buildIndex(apps)
    this.byId = undefined
    try {
      await writeFile(path, JSON.stringify(apps), 'utf8')
    } catch {
      // A cache that cannot be written is no reason to discard the list
      // that was just fetched.
    }
    return apps.length
  }
}
