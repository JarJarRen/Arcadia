import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'
import { authorizationHeader, type XboxToken } from './xbox'

const endpoint = (xuid: string): string =>
  `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/detail`

/**
 * The device names that mean "runs on this machine".
 *
 * A title history spans consoles as well, and an Xbox One game in a Windows
 * library would be a row that can never be launched.
 */
const PC_DEVICES = new Set(['PC', 'Win32'])

export interface PlayedTitle {
  packageFamilyName: string
  name: string
  /** Unix seconds, like every other date in the library. */
  lastPlayed?: number
}

/**
 * Everything the account has played, as far as it concerns a PC.
 *
 * Supplies the two things `collections.ts` cannot: when a game was last
 * played, and which installed packages are games at all.
 */
export async function readPlayedTitles(
  token: XboxToken,
  deps: { http?: HttpFn; locale?: string } = {}
): Promise<PlayedTitle[]> {
  // `authorizeXsts` silently defaults `xuid` to '' when the Xbox claims omit
  // `xid`. Left unchecked that empty string would be interpolated straight
  // into the endpoint below as `xuid()`, a malformed call to a live
  // Microsoft service. Fail fast with a clear reason instead of sending it.
  if (token.xuid === '') {
    throw new Error(t().stores.microsoft.missingXuid)
  }

  const http = deps.http ?? defaultHttp
  const response = await http(endpoint(token.xuid), {
    headers: {
      Authorization: authorizationHeader(token),
      // Version 2 is what returns the `pfn` field; version 1 does not.
      'x-xbl-contract-version': '2',
      Accept: 'application/json',
      'Accept-Language': deps.locale ?? t().format.locale
    }
  })

  if (!response.ok) {
    throw new Error(t().stores.microsoft.titleHistoryFailed(String(response.status)))
  }

  const body = (await response.json()) as {
    titles?: Array<{
      name?: unknown
      pfn?: unknown
      devices?: unknown
      titleHistory?: { lastTimePlayed?: unknown }
    }>
  }

  const titles: PlayedTitle[] = []
  for (const title of body.titles ?? []) {
    const packageFamilyName = title.pfn
    const name = title.name
    if (typeof packageFamilyName !== 'string' || packageFamilyName === '') continue
    if (typeof name !== 'string' || name === '') continue

    const devices = Array.isArray(title.devices) ? title.devices : []
    if (!devices.some((device) => typeof device === 'string' && PC_DEVICES.has(device))) continue

    const lastPlayed = unixSeconds(title.titleHistory?.lastTimePlayed)
    titles.push({
      packageFamilyName,
      name,
      ...(lastPlayed === undefined ? {} : { lastPlayed })
    })
  }
  return titles
}

function unixSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000)
}
