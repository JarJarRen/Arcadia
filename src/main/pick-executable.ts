import { t } from '@shared/i18n'
import type { PickedExecutable } from '@shared/ipc'
import {
  defaultNameFor,
  executableProblem,
  isShortcut,
  parseArguments
} from '@shared/executable'

/**
 * Everything this needs from the outside world.
 *
 * Injected as plain functions so the whole flow — dialog, shortcut, checks —
 * is testable without Electron and without a filesystem. `src/main/ipc.ts`
 * builds the real ones.
 */
export interface PickDeps {
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
  /** Electron's `shell.readShortcutLink`. Windows only; throws when unreadable. */
  readShortcutLink: (path: string) => { target: string; args?: string }
  exists: (path: string) => Promise<boolean>
  platform: NodeJS.Platform
}

/**
 * Asks for the program a storeless game starts.
 *
 * The dialog opens in the **main** process, so the renderer never names a
 * path — it receives one. That is the same reasoning as `game:open-folder`
 * taking a merge key rather than a folder.
 *
 * A Windows shortcut is resolved here, once, and the resolved target is what
 * travels onward. `spawn` cannot run a `.lnk` at all, and a shortcut is the
 * most natural thing for someone to pick — it is what sits on their desktop.
 * Its arguments come along too, so a launcher that was already configured
 * through its shortcut keeps that configuration.
 *
 * `{ ok: false }` with **no** error means the dialog was closed. Closing a
 * dialog is not a failure, and a message about it would be noise on a screen
 * the user has just dismissed.
 */
export async function pickExecutable(deps: PickDeps): Promise<PickedExecutable> {
  const chosen = await deps.showOpenDialog()
  const picked = chosen.filePaths[0]
  if (chosen.canceled || picked === undefined) return { ok: false }

  let exe = picked
  let args: string[] = []
  // The shortcut's own name beats the target's: "Minecraft Launcher" is what
  // the user recognises, "mc" is what the file happens to be called.
  let suggestedName = defaultNameFor(picked)

  if (deps.platform === 'win32' && isShortcut(picked)) {
    try {
      const link = deps.readShortcutLink(picked)
      exe = link.target
      args = parseArguments(link.args ?? '')
    } catch {
      return { ok: false, error: t().errors.shortcutUnreadable }
    }
  } else {
    suggestedName = defaultNameFor(exe)
  }

  const problem = executableProblem(exe, deps.platform)
  if (problem === 'notAbsolute') return { ok: false, error: t().errors.executableNotAbsolute }
  if (problem === 'unsupportedType') {
    return { ok: false, error: t().errors.executableUnsupported }
  }

  if (!(await deps.exists(exe))) {
    return { ok: false, error: t().errors.executableMissing(exe) }
  }

  return { ok: true, exe, args, suggestedName }
}
