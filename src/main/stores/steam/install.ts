import { win32 } from 'node:path'
import { t } from '@shared/i18n'
import type { GuidedInstall } from '@main/stores/types'

/**
 * Steam's main window is called "Steam" in every language — it is the
 * product name, not a translated word. Whatever else the wizard is, it is
 * not this.
 */
const MAIN_WINDOW_TITLE = 'Steam'

/**
 * The processes that own Steam's windows.
 *
 * Both, because the modern Chromium-based client renders its dialogs out
 * of the helper process. Watching steam.exe alone would never see the
 * wizard at all.
 */
const PROCESS_NAMES = ['steam.exe', 'steamwebhelper.exe']

/**
 * Height the install wizard is grown to when it opens shorter than this.
 *
 * Measured on the owner's machine: launched via a `steam://install/` URI
 * the wizard opens at 540x480, natural size, with the Install button below
 * the fold — it needs scrolling to reach. Resized by hand to 540x760, the
 * button was on screen without scrolling. 760 is that verified height.
 */
const WIZARD_MIN_HEIGHT = 760

/**
 * Builds the guided route, or nothing where there is none.
 *
 * `win32.join` rather than the ambient `join` for the same reason as in
 * paths.ts: the ambient one is bound to the running operating system, not
 * to the one being described, which would make this untestable from Linux.
 */
export function steamGuidedInstall(
  steamPath: string | undefined,
  installUri: string,
  platform: NodeJS.Platform = process.platform
): GuidedInstall | undefined {
  if (platform !== 'win32') return undefined
  if (steamPath === undefined || steamPath === '') return undefined

  return {
    exe: win32.join(steamPath, 'steam.exe'),
    // -silent keeps the client in the tray. The URI is forwarded to an
    // already-running instance, so this one command covers the cold start
    // and the warm one without a branch that could be got wrong.
    args: ['-silent', installUri],
    processNames: PROCESS_NAMES,
    ignoreTitles: [MAIN_WINDOW_TITLE],
    minHeight: WIZARD_MIN_HEIGHT,
    timeoutNotice: t().stores.steam.noInstallDialog
  }
}
