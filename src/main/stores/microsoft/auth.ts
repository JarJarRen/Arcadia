import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'

export type { HttpFn }

/**
 * Arcadia's own public client.
 *
 * Published on purpose: a public client has no secret by definition, and
 * the device-code flow is specified for exactly this case. The alternative —
 * asking every user to register an Azure application — is far more work than
 * copying a Steam key, and is where most people would stop.
 */
export const MICROSOFT_CLIENT_ID = '00000000-0000-0000-0000-000000000000'

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

    // The wait before the *next* poll uses whatever interval was current
    // when this answer came back. `slow_down` grows the interval for polls
    // after this one — the interval it complained about has already been
    // waited out by the time the answer arrives, so re-sending it now would
    // just get throttled again.
    await sleep(intervalMs)
    if (error === 'slow_down') {
      intervalMs += 5000
    }
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
  if (!response.ok) throw new Error(errorText(body, response.status))

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
