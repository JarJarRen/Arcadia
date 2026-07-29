import type { RawGame } from '@shared/types'
import { t } from '@shared/i18n'

export type FetchFn = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export type SteamApiErrorKind = 'auth' | 'private' | 'network' | 'unexpected'

export class SteamApiError extends Error {
  constructor(
    readonly kind: SteamApiErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'SteamApiError'
  }
}

export interface OwnedGamesOptions {
  apiKey: string
  steamId64: string
  fetchFn?: FetchFn
}

interface OwnedGameEntry {
  appid: number
  name?: string
  playtime_forever?: number
  rtime_last_played?: number
}

const ENDPOINT = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'

export async function fetchOwnedGames(options: OwnedGamesOptions): Promise<RawGame[]> {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn)

  const url =
    `${ENDPOINT}?key=${encodeURIComponent(options.apiKey)}` +
    `&steamid=${encodeURIComponent(options.steamId64)}` +
    '&include_appinfo=1&include_played_free_games=1&format=json'

  let response
  try {
    response = await fetchFn(url)
  } catch {
    // The original error message is discarded on purpose: it can contain
    // the full URL including the API key and would otherwise reach the log.
    throw new SteamApiError('network', t().stores.steam.unreachable)
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SteamApiError('auth', t().stores.steam.apiKeyRejected)
    }
    throw new SteamApiError(
      'unexpected',
      t().stores.steam.unexpectedStatus(response.status)
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SteamApiError('unexpected', t().stores.steam.invalidJson)
  }

  // JSON.parse('null') returns null without throwing — so the catch above
  // does not fire. Reaching straight for .response would then produce a bare
  // TypeError and break this module's promise that every failure comes out
  // as a SteamApiError.
  if (typeof payload !== 'object' || payload === null) {
    throw new SteamApiError('unexpected', t().stores.steam.unexpectedShape)
  }

  const container = (payload as { response?: unknown }).response
  if (typeof container !== 'object' || container === null) {
    throw new SteamApiError('unexpected', t().stores.steam.unexpectedShape)
  }
  const fields = container as Record<string, unknown>

  // For private profiles Steam returns HTTP 200 with an empty response
  // object — without game_count. An account with no games, by contrast, has
  // game_count: 0. That difference is the only way to tell the cases apart,
  // and without it a private profile would look like an empty library.
  // Missing AND null are treated the same: both mean "no answer given".
  // Only a real number — including 0 — counts as an answer.
  if (fields.game_count === undefined || fields.game_count === null) {
    throw new SteamApiError('private', t().stores.steam.privateProfile)
  }

  const entries = Array.isArray(fields.games) ? (fields.games as OwnedGameEntry[]) : []

  return entries.flatMap((entry) => {
    const appId = String(entry.appid)
    // As in the manifest parser: the AppID ends up in a URI that goes to
    // the shell. Steam could not launch a non-numeric ID anyway, so skipping
    // it beats passing it on.
    if (!/^\d+$/.test(appId)) return []

    const game: RawGame = {
      storeGameId: appId,
      name: entry.name ?? `Unknown game (${entry.appid})`,
      // What is installed is decided solely by the local manifest scan.
      // The API does not know.
      installed: false
    }
    if (entry.playtime_forever !== undefined) {
      game.playtimeMinutes = entry.playtime_forever
    }
    if (entry.rtime_last_played !== undefined && entry.rtime_last_played > 0) {
      game.lastPlayed = entry.rtime_last_played
    }
    return [game]
  })
}
