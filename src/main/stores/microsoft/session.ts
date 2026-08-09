import { refreshTokens as defaultRefreshTokens, type MicrosoftTokens } from './auth'
import {
  authenticateXboxUser as defaultAuthenticateXboxUser,
  authorizeXsts as defaultAuthorizeXsts,
  MARKETPLACE_RELYING_PARTY,
  XBOX_LIVE_RELYING_PARTY,
  type XboxToken
} from './xbox'

/**
 * Where the refresh token is kept.
 *
 * An interface rather than a path: the value is written to the `settings`
 * table through an encrypting pair supplied by `main/index.ts`, and this
 * module must not know which of those it is talking to.
 */
export interface TokenStore {
  read(): string | undefined
  write(value: string | undefined): void
}

export interface MicrosoftSessionDeps {
  store: TokenStore
  refreshTokens?: (refreshToken: string) => Promise<MicrosoftTokens>
  authenticateXboxUser?: (accessToken: string) => Promise<string>
  authorizeXsts?: (userToken: string, relyingParty: string) => Promise<XboxToken>
}

export interface XboxTokens {
  xboxLive: XboxToken
  marketplace: XboxToken
}

/**
 * A signed-in Microsoft account, as far as Arcadia needs one.
 *
 * Only the refresh token survives a restart. The access tokens are good for
 * minutes and are derived again at the start of every scan, which is cheap
 * and removes any question of an expired token sitting in the database.
 */
export class MicrosoftSession {
  private readonly store: TokenStore
  private readonly refresh: NonNullable<MicrosoftSessionDeps['refreshTokens']>
  private readonly authenticate: NonNullable<MicrosoftSessionDeps['authenticateXboxUser']>
  private readonly authorize: NonNullable<MicrosoftSessionDeps['authorizeXsts']>
  private name: string | undefined
  /**
   * The exchange that is running right now, if one is.
   *
   * Two scans can be in flight at once — `scan-state.ts` says so in as many
   * words: a Refresh click while the startup scan is still going is an
   * obvious thing to do when the library looks empty. Both would reach
   * `tokens()`, both would read the same stored refresh token, and both
   * would present it. Microsoft's consumer endpoint rotates refresh tokens
   * and invalidates the one presented, so the second exchange comes back
   * `invalid_grant` — a definitive refusal, which signs the account out.
   * The user pressed Refresh and was logged out.
   *
   * Sharing the promise is what makes that impossible: the second caller
   * waits on the first exchange instead of starting a competing one.
   */
  private pending: Promise<XboxTokens | undefined> | undefined

  constructor(deps: MicrosoftSessionDeps) {
    this.store = deps.store
    this.refresh = deps.refreshTokens ?? ((token) => defaultRefreshTokens(token))
    this.authenticate = deps.authenticateXboxUser ?? ((token) => defaultAuthenticateXboxUser(token))
    this.authorize =
      deps.authorizeXsts ?? ((userToken, party) => defaultAuthorizeXsts(userToken, party))
  }

  isSignedIn(): boolean {
    const stored = this.store.read()
    return stored !== undefined && stored !== ''
  }

  /** Known only after a successful exchange — the claims carry it. */
  gamertag(): string | undefined {
    return this.name
  }

  signIn(tokens: MicrosoftTokens): void {
    this.store.write(tokens.refreshToken)
  }

  signOut(): void {
    this.store.write(undefined)
    this.name = undefined
  }

  /**
   * Both service tokens, or undefined when nobody is signed in.
   *
   * Undefined rather than throwing: being signed out is a state the scan
   * handles by listing less, not a failure it should report.
   *
   * A rejected refresh token signs the account out, because it will be
   * rejected identically for ever — every later scan would fail the same
   * way with no route back but a sign-out nobody knew to perform. Any other
   * failure, a dropped connection above all, leaves the sign-in alone.
   *
   * Overlapping callers share one exchange; see `pending`. The promise is
   * dropped as soon as it settles, so the next scan derives fresh access
   * tokens rather than reusing ones that have since expired.
   */
  tokens(): Promise<XboxTokens | undefined> {
    if (this.pending !== undefined) return this.pending

    const pending = this.exchange().finally(() => {
      // Guarded rather than cleared outright: a later exchange may already
      // have taken the slot by the time this one settles.
      if (this.pending === pending) this.pending = undefined
    })
    this.pending = pending
    return pending
  }

  private async exchange(): Promise<XboxTokens | undefined> {
    const stored = this.store.read()
    if (stored === undefined || stored === '') return undefined

    let microsoft: MicrosoftTokens
    try {
      microsoft = await this.refresh(stored)
    } catch (error) {
      this.signOut()
      throw error
    }
    this.store.write(microsoft.refreshToken)

    const userToken = await this.authenticate(microsoft.accessToken)
    // Both audiences from the one user token: signing in once is enough for
    // the title history and the entitlement service together.
    const [xboxLive, marketplace] = await Promise.all([
      this.authorize(userToken, XBOX_LIVE_RELYING_PARTY),
      this.authorize(userToken, MARKETPLACE_RELYING_PARTY)
    ])

    if (xboxLive.gamertag !== '') this.name = xboxLive.gamertag
    return { xboxLive, marketplace }
  }
}
