import type { AvailabilityResult, Game, RawGame, StoreId } from '@shared/types'

export interface StoreAdapter {
  readonly id: StoreId
  readonly displayName: string

  /** Is the store usable on this platform at all? */
  isAvailable(): Promise<AvailabilityResult>

  /** Locally installed games — offline, no login. */
  scanInstalled(): Promise<RawGame[]>

  /** Owned games, possibly not installed. Only where cleanly possible. */
  scanOwned?(): Promise<RawGame[]>

  /**
   * Returns the URI that launches the game.
   *
   * The adapter does not launch anything itself: `shell.openExternal` lives
   * in Electron, and adapters must not import Electron (see the global
   * constraints). The caller in `src/main/launch-bridge.ts` runs the URI.
   */
  launchUri(game: Game): string

  /**
   * Returns the URI that makes the store download the game.
   *
   * Same mechanism as `launchUri`, only with a different verb — all four
   * launchers register a protocol handler. Arcadia downloads nothing
   * itself; the store takes over, we merely open its dialog.
   *
   * Throws when the game cannot be installed this way. The message reaches
   * the user, so it has to explain rather than merely abort.
   */
  installUri(game: Game): string

  /**
   * Explanation shown after an install click.
   *
   * Set only when `installUri` does **not** actually install. EA is that
   * case: its launcher has no deep link for installing, only one that
   * opens the library. Without this hint the click would look as though it
   * had done nothing.
   */
  readonly installNotice?: string
}
