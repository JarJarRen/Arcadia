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
   */
  async tokens(): Promise<XboxTokens | undefined> {
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
