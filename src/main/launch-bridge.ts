import { spawn } from 'node:child_process'
import { shell } from 'electron'
import type { Game } from '@shared/types'
import type { LaunchResult } from '@shared/ipc'
import { t } from '@shared/i18n'
import type { GuidedInstall, StoreAdapter } from '@main/stores/types'
import { runWindowAgent, type AgentHandle, type AgentTarget } from '@main/platform/windows'

/** Starts a program. Injected in tests; in production a detached spawn. */
export type RunCommand = (
  exe: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<void>

/**
 * Starts the command and stops caring about it.
 *
 * `detached` with `unref` so the game outlives Arcadia — closing the library
 * must not take the game down with it — and `windowsHide` so `explorer.exe`
 * does not flash a console window on the way through.
 *
 * Settles on the spawn outcome, not on the process exiting — a launched game
 * runs for hours, and this only needs to know whether it started. That also
 * means the returned promise must not resolve until Node either confirms the
 * process started or reports that it could not: an `'error'` event with no
 * listener throws, and by the time an `async` function's body has returned,
 * nothing is left to catch a throw that arrives after the fact. Listening
 * for `'error'` turns that throw into a rejection `open()`'s `catch` can
 * turn into a clean `{ ok: false }` instead of taking Arcadia down with it.
 */
const defaultRun: RunCommand = (exe, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // Spread rather than `cwd: options?.cwd`: passing an explicit
      // `undefined` is not the same as omitting it for every option Node
      // reads, and the stores that name no directory must keep inheriting
      // Arcadia's own.
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd })
    })
    child.once('error', reject)
    child.once('spawn', () => {
      // Only after the process really started: unref'ing lets the game
      // outlive Arcadia, which is the whole point of the detached spawn.
      child.unref()
      resolve()
    })
  })

/**
 * Runs an adapter's launch URI.
 *
 * This file is the only place where adapter output meets Electron — which
 * is what lets the adapters themselves stay Electron-free, and therefore
 * testable without Electron.
 */
export async function launchGame(
  adapters: StoreAdapter[],
  game: Game,
  run: RunCommand = defaultRun
): Promise<LaunchResult> {
  return open(adapters, game, 'launch', run)
}

/** Arcadia's own window, as the agent needs to see it. */
export interface InstallFrame {
  target: AgentTarget
  owner: string
}

export interface InstallAssist {
  /**
   * Arcadia's rectangle and handle, or undefined when there is no usable
   * window — minimised, destroyed, not yet created.
   */
  frame: () => InstallFrame | undefined
  /** Injection point for tests. In production the real agent runs. */
  run?: typeof runWindowAgent
  /**
   * Holds Arcadia above Steam's windows, or releases it.
   *
   * Replaces pushing Steam's windows down every guard tick — a fight Steam
   * kept winning by raising itself again. Holding the z-order from Arcadia's
   * side instead leaves nothing to fight.
   */
  setAlwaysOnTop: (value: boolean) => void
}

/** How long to wait for the store's dialog before giving up on it. */
const TIMEOUT_MS = 30_000

/**
 * How long to keep Steam's other windows below Arcadia after placing the
 * wizard.
 *
 * A ceiling, not a duration: the agent stops as soon as the wizard closes.
 * It is generous because the user decides how long the wizard stays up, and
 * a guard that expires while they are still choosing a drive is what let
 * Steam's client climb back over Arcadia.
 */
const GUARD_MS = 600_000

/**
 * The agent of the install currently being waited on.
 *
 * At most one: a second install cancels the first, because two agents
 * fighting over the z-order would be worse than either alone.
 */
let current: AgentHandle | undefined

/**
 * Opens the store's install dialog.
 *
 * Arcadia downloads nothing itself — it hands the store the same kind of
 * URI as for launching, only with a different verb. Where the store has a
 * guided route and Arcadia has a window to centre on, the agent takes over
 * and the shell is not involved at all.
 */
export async function installGame(
  adapters: StoreAdapter[],
  game: Game,
  assist?: InstallAssist
): Promise<LaunchResult> {
  const adapter = adapters.find((candidate) => candidate.id === game.storeId)
  if (adapter === undefined) {
    return { ok: false, error: t().errors.noAdapter(game.storeId) }
  }

  let plan: GuidedInstall | undefined
  try {
    // Building the URI validates the game ID and throws on invalid values.
    // Doing it before anything else means a bad ID never reaches a process
    // start.
    adapter.installUri(game)
    plan = assist === undefined ? undefined : await adapter.guidedInstall?.(game)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: t().errors.installNameFailed(game.name, message) }
  }

  if (plan === undefined || assist === undefined) return open(adapters, game, 'install')

  const frame = assist.frame()
  if (frame === undefined) return open(adapters, game, 'install')

  return guided(adapters, game, plan, assist, frame)
}

/**
 * Stops waiting for the store's install dialog.
 *
 * Cancels the **assistance**, not the installation: the store already has
 * the URI and carries on downloading. Only the agent ends.
 */
export function cancelInstall(): void {
  current?.cancel()
  current = undefined
}

async function guided(
  adapters: StoreAdapter[],
  game: Game,
  plan: GuidedInstall,
  assist: InstallAssist,
  frame: InstallFrame
): Promise<LaunchResult> {
  // Before starting the next one, so the two never overlap.
  cancelInstall()

  // Cleared in the finally below on every exit path — success, timeout,
  // denied placement, a cancelled agent, the started:false fallback, or
  // something throwing. Leaving Arcadia stuck always-on-top would be a far
  // worse bug than the one this guards against, so the finally is the point
  // of this, not an afterthought.
  assist.setAlwaysOnTop(true)
  try {
    const run = assist.run ?? runWindowAgent
    const handle = run({
      exe: plan.exe,
      args: plan.args,
      processNames: plan.processNames,
      ignoreTitles: plan.ignoreTitles,
      target: frame.target,
      owner: frame.owner,
      timeoutMs: TIMEOUT_MS,
      guardMs: GUARD_MS,
      minHeight: plan.minHeight
    })
    current = handle

    if (!(await handle.started)) {
      // The agent is what starts the store, so an agent that never got that
      // far has installed nothing. Without this the click does nothing at
      // all — no window, no error, no download.
      const detail = await handle.startedDetail
      // Console-only: whoever reads this is debugging, not playing, so it
      // stays out of the translated strings in shared/i18n.ts.
      if (detail !== undefined) console.error('Window agent failed to start the store:', detail)
      if (current === handle) current = undefined
      return open(adapters, game, 'install')
    }

    const placed = await handle.placed

    if (placed?.ok === false) {
      // Console-only: see the note at the top of shared/i18n.ts. A denied
      // placement is silent to the user — the same outcome as a wizard
      // Steam quietly moved back after a placement that had succeeded — so
      // without this there was no way to tell the two apart from outside
      // the process.
      //
      // The command goes in the line too. A timeout means no window ever
      // appeared, and the first thing worth checking is then whether the
      // store was asked for the right thing at all: the same URI run by
      // hand opened a dialog immediately while the app timed out on it,
      // and without the command in the log there was no way to compare the
      // two.
      console.error(
        'Window agent failed to place the install wizard:',
        placed.reason,
        '- asked for:',
        plan.exe,
        plan.args.join(' '),
        '- agent ran:',
        (await handle.startedDetail) ?? '(not reported)'
      )
    }

    // A timeout is the only outcome worth a word. A refused placement means
    // the install is running and only the window could not be moved, and a
    // cancelled agent means the user asked for the waiting to stop.
    const outcome: LaunchResult =
      placed?.ok === false && placed.reason === 'timeout'
        ? { ok: true, notice: plan.timeoutNotice }
        : { ok: true }

    // Deliberately outlives the placement: the renderer's overlay is up for
    // exactly as long as this promise is pending, and it is meant to cover
    // the store's dialog for as long as the dialog is open, not clear the
    // instant it appears. `current` has to stay set for the same span, or
    // cancelInstall() — Escape or a backdrop press on the overlay — would
    // have no agent left to cancel while the wizard is still up.
    await handle.finished
    if (current === handle) current = undefined

    return outcome
  } finally {
    assist.setAlwaysOnTop(false)
  }
}

async function open(
  adapters: StoreAdapter[],
  game: Game,
  action: 'launch' | 'install',
  run: RunCommand = defaultRun
): Promise<LaunchResult> {
  const adapter = adapters.find((candidate) => candidate.id === game.storeId)
  if (adapter === undefined) {
    return { ok: false, error: t().errors.noAdapter(game.storeId) }
  }

  // A command where the adapter has one, a URI otherwise. Installing always
  // goes through a URI: every store, Microsoft included, has a protocol for
  // opening a product page.
  if (action === 'launch' && adapter.launchCommand !== undefined) {
    try {
      const command = adapter.launchCommand(game)
      await run(command.exe, command.args, command.cwd === undefined ? undefined : { cwd: command.cwd })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: t().errors.launchNameFailed(game.name, message) }
    }
  }

  // Building the URI validates the game ID and throws on invalid values —
  // which is why it sits inside the try. Otherwise the error would reach
  // the renderer as a rejected promise instead of a clean message.
  let uri: string | undefined
  try {
    uri = action === 'launch' ? adapter.launchUri(game) : adapter.installUri(game)
    await shell.openExternal(uri)
    const notice = action === 'install' ? adapter.installNotice : undefined
    return notice === undefined ? { ok: true } : { ok: true, notice }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Include the URI whenever it was produced: without it a failure is
    // impossible to trace.
    if (uri === undefined) {
      return {
        ok: false,
        error:
          action === 'launch'
            ? t().errors.launchNameFailed(game.name, message)
            : t().errors.installNameFailed(game.name, message)
      }
    }
    return {
      ok: false,
      error:
        action === 'launch'
          ? t().errors.launchUriFailed(uri, message)
          : t().errors.installUriFailed(uri, message)
    }
  }
}
