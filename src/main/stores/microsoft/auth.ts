import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'

export type { HttpFn }

/**
 * Arcadia's own public client.
 *
 * Committed on purpose: a public client has no secret by definition, and the
 * device-code flow is specified for exactly this case. The value identifies
 * the *application* to Microsoft, never a user, and grants whoever reads it
 * no access to anything.
 *
 * It is registered once, by Arcadia, rather than by each person who runs it.
 * The alternative — every user creating their own Azure application — is far
 * more work than copying a Steam key and is where most people would stop.
 * Each user still signs in with their own Microsoft account against this one
 * registration.
 *
 * The registration is a public client with personal Microsoft accounts only,
 * matching the `/consumers/` endpoints below, and with public client flows
 * allowed — the device-code grant is refused without that.
 */
export const MICROSOFT_CLIENT_ID = '43221990-7644-4115-83ce-c7d062178f4c'

const DEVICE_CODE_ENDPOINT =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'

/**
 * `XboxLive.signin` is what the Xbox token exchange needs; `offline_access`
 * is what makes the next start silent rather than a second sign-in.
 */
const SCOPE = 'XboxLive.signin offline_access'

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  intervalSeconds: number
}

export interface MicrosoftTokens {
  accessToken: string
  refreshToken: string
}

/**
 * A refusal that no amount of retrying will get past.
 *
 * The distinction matters exactly once, and it is the difference between an
 * inconvenience and a silent sign-out: `session.ts` discards the stored
 * credential for this error and for nothing else. `refreshTokens` otherwise
 * throws for every non-`ok` answer, and `defaultHttp` is bare `fetch`, which
 * also rejects on a DNS failure, a dropped connection, a captive portal, a
 * 429 or a 5xx. A laptop that starts Arcadia before the Wi-Fi has associated
 * must not lose its account over it.
 */
export class OAuthRefusedError extends Error {
  constructor(
    /** The OAuth error code, e.g. `invalid_grant`. */
    readonly reason: string,
    message: string
  ) {
    super(message)
    this.name = 'OAuthRefusedError'
  }
}

/**
 * The two answers that mean the credential itself is dead.
 *
 * `invalid_grant` is a refresh token that has been revoked, expired or
 * already been redeemed; `invalid_client` is a client the tenant no longer
 * accepts. Both would be answered identically for ever.
 */
const DEFINITIVE_REFUSALS = new Set(['invalid_grant', 'invalid_client'])

/** Narrows across the module boundary without exporting the class shape. */
export function isOAuthRefusal(error: unknown): error is OAuthRefusedError {
  return error instanceof OAuthRefusedError
}

export interface AuthDeps {
  http?: HttpFn
  /** Injected so the polling tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Polling stops as soon as this returns true. */
  cancelled?: () => boolean
}

const form = (fields: Record<string, string>): string =>
  new URLSearchParams(fields).toString()

const POST_FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }

export async function requestDeviceCode(deps: AuthDeps = {}): Promise<DeviceCode> {
  const http = deps.http ?? defaultHttp
  const response = await http(DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: POST_FORM,
    body: form({ client_id: MICROSOFT_CLIENT_ID, scope: SCOPE })
  })

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) throw new Error(errorText(body, response.status))

  const deviceCode = String(body.device_code ?? '')
  const userCode = String(body.user_code ?? '')
  const verificationUri = String(body.verification_uri ?? '')
  if (deviceCode === '' || userCode === '' || verificationUri === '') {
    throw new Error(t().stores.microsoft.signInFailed(String(response.status)))
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    // Microsoft's own default when it names none.
    intervalSeconds: typeof body.interval === 'number' ? body.interval : 5
  }
}

/**
 * Waits for the sign-in to happen in the browser.
 *
 * Four answers matter and they are not interchangeable:
 * `authorization_pending` means keep waiting, `slow_down` means the interval
 * was too short and must grow — ignoring it gets the client throttled
 * outright — and `expired_token` and `authorization_declined` are the end.
 */
export async function pollForTokens(
  code: DeviceCode,
  deps: AuthDeps = {}
): Promise<MicrosoftTokens> {
  const http = deps.http ?? defaultHttp
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)))
  let intervalMs = code.intervalSeconds * 1000

  for (;;) {
    if (deps.cancelled?.() === true) {
      throw new Error(t().stores.microsoft.signInCancelled)
    }

    const response = await http(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: POST_FORM,
      body: form({
        client_id: MICROSOFT_CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.deviceCode
      })
    })
    const body = (await response.json()) as Record<string, unknown>

    if (response.ok) return tokensFrom(body, '')

    const error = String(body.error ?? '')
    if (error !== 'slow_down' && error !== 'authorization_pending') {
      throw new Error(refusalText(error, body, response.status))
    }

    // RFC 8628 §3.5: on `slow_down` the interval "MUST be increased by 5
    // seconds for this and all subsequent requests" — "this" is the very
    // next poll, so the increment has to land before the wait that precedes
    // it. Waiting the old, too-short interval right after being told to
    // slow down is exactly what gets a client throttled outright.
    if (error === 'slow_down') {
      intervalMs += 5000
    }
    await sleep(intervalMs)
  }
}

export async function refreshTokens(
  refreshToken: string,
  deps: AuthDeps = {}
): Promise<MicrosoftTokens> {
  const http = deps.http ?? defaultHttp
  const response = await http(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: POST_FORM,
    body: form({
      client_id: MICROSOFT_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE
    })
  })

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    const reason = typeof body.error === 'string' ? body.error : ''
    // A 400-family answer naming one of the two dead-credential codes, and
    // only that: a 500 saying `invalid_grant` would be the service having a
    // bad day, not a verdict on the token.
    if (response.status >= 400 && response.status < 500 && DEFINITIVE_REFUSALS.has(reason)) {
      throw new OAuthRefusedError(reason, errorText(body, response.status))
    }
    throw new Error(errorText(body, response.status))
  }

  // Microsoft rotates the refresh token, but does not always send a new one.
  // Keeping the old one is what stops a silent sign-out on the next start.
  return tokensFrom(body, refreshToken)
}

function tokensFrom(body: Record<string, unknown>, fallback: string): MicrosoftTokens {
  const accessToken = String(body.access_token ?? '')
  if (accessToken === '') throw new Error(t().stores.microsoft.signInFailed('token'))
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : fallback
  return { accessToken, refreshToken }
}

function errorText(body: Record<string, unknown>, status: number): string {
  const error = typeof body.error === 'string' ? body.error : String(status)
  return t().stores.microsoft.signInFailed(error)
}

/** The three ends of a device-code flow, each said as itself. */
function refusalText(error: string, body: Record<string, unknown>, status: number): string {
  if (error === 'expired_token') return t().stores.microsoft.signInExpired
  if (error === 'authorization_declined') return t().stores.microsoft.signInDeclined
  return errorText(body, status)
}
