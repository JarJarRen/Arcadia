import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'

const USER_AUTH_ENDPOINT = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_ENDPOINT = 'https://xsts.auth.xboxlive.com/xsts/authorize'

/** The title history and everything else under the Xbox Live umbrella. */
export const XBOX_LIVE_RELYING_PARTY = 'http://xboxlive.com'
/** The entitlement service. A token for the other audience is refused here. */
export const MARKETPLACE_RELYING_PARTY = 'http://mp.microsoft.com/'

export interface XboxToken {
  token: string
  userHash: string
  xuid: string
  gamertag: string
}

export interface XboxDeps {
  http?: HttpFn
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'x-xbl-contract-version': '1'
}

export async function authenticateXboxUser(
  microsoftAccessToken: string,
  deps: XboxDeps = {}
): Promise<string> {
  const http = deps.http ?? defaultHttp
  const response = await http(USER_AUTH_ENDPOINT, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        // The `d=` prefix marks this as a delegation ticket. Without it the
        // service answers 400 with no explanation at all.
        RpsTicket: `d=${microsoftAccessToken}`
      }
    })
  })

  if (!response.ok) {
    throw new Error(t().stores.microsoft.xboxAuthFailed(String(response.status)))
  }

  const body = (await response.json()) as { Token?: unknown }
  const token = typeof body.Token === 'string' ? body.Token : ''
  if (token === '') throw new Error(t().stores.microsoft.xboxAuthFailed('token'))
  return token
}

/**
 * Trades the user token for one that a specific service will accept.
 *
 * Both audiences come from the *same* user token, so signing in once yields
 * both. The XUID and gamertag ride along in the display claims, which is
 * where the interface gets the name it shows.
 */
export async function authorizeXsts(
  userToken: string,
  relyingParty: string,
  deps: XboxDeps = {}
): Promise<XboxToken> {
  const http = deps.http ?? defaultHttp
  const response = await http(XSTS_ENDPOINT, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      RelyingParty: relyingParty,
      TokenType: 'JWT',
      Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] }
    })
  })

  const body = (await response.json()) as {
    Token?: unknown
    XErr?: unknown
    DisplayClaims?: { xui?: Array<{ uhs?: unknown; xid?: unknown; gtg?: unknown }> }
  }

  if (!response.ok) throw new Error(xstsRefusal(body.XErr, response.status))

  const claims = body.DisplayClaims?.xui?.[0]
  const token = typeof body.Token === 'string' ? body.Token : ''
  const userHash = typeof claims?.uhs === 'string' ? claims.uhs : ''
  if (token === '' || userHash === '') {
    throw new Error(t().stores.microsoft.xboxAuthFailed('claims'))
  }

  return {
    token,
    userHash,
    xuid: typeof claims?.xid === 'string' ? claims.xid : '',
    gamertag: typeof claims?.gtg === 'string' ? claims.gtg : ''
  }
}

/**
 * The two refusals a person can actually do something about.
 *
 * Everything else keeps its number: an unexplained code is at least
 * searchable, whereas a wrong explanation is not.
 */
function xstsRefusal(xerr: unknown, status: number): string {
  if (xerr === 2148916233) return t().stores.microsoft.noXboxProfile
  if (xerr === 2148916238) return t().stores.microsoft.childAccount
  return t().stores.microsoft.xboxAuthFailed(String(xerr ?? status))
}

export function authorizationHeader(token: XboxToken): string {
  return `XBL3.0 x=${token.userHash};${token.token}`
}
