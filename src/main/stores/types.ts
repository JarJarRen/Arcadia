import type { AvailabilityResult, Game, RawGame, StoreId } from '@shared/types'

/**
 * How to install without the store's main window taking over.
 *
 * Plain data, so an adapter can describe the route without importing
 * Electron — the bridge is still the only place that acts on it.
 */
export interface GuidedInstall {
  /** Executable to run instead of handing the URI to the shell. */
  exe: string
  /** Arguments, the install URI last. */
  args: string[]
  /** Image names whose top-level windows count as the store's. */
  processNames: string[]
  /** Exact window titles that are never the install dialog. */
  ignoreTitles: string[]
  /** Height to grow the dialog to if it opens shorter than this. 0 means do not resize. */
  minHeight: number
  /** Shown as a notice when no dialog appears within the timeout. */
  timeoutNotice: string
}

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
   * How to launch, where a URI cannot do it.
   *
   * The Microsoft Store is the case: a packaged game is activated through
   * `shell:AppsFolder\<AUMID>`, which is a shell namespace path rather than
   * a protocol, and `shell.openExternal` cannot open it.
   *
   * Returned as plain data for the same reason as `GuidedInstall`: the
   * bridge is the only place that starts a process, so adapters stay free of
   * Electron and testable without it. When this is absent — every store but
   * Microsoft — `launchUri` is used exactly as before.
   *
   * Throws when the game cannot be launched. The message reaches the user.
   */
  launchCommand?(game: Game): { exe: string; args: string[] }

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
   * The guided route for `installUri`, when the store has one.
   *
   * Returns undefined where the plain URI is all there is — which is every
   * store but Steam, and Steam on any platform without the window agent.
   * The notice travels with the plan rather than being looked up by the
   * bridge, so the bridge needs no per-store knowledge to explain a
   * timeout.
   */
  guidedInstall?(game: Game): Promise<GuidedInstall | undefined>

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
