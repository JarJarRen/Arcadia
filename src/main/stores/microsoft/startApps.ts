import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { ExecFn } from '@main/platform/registry'

const execAsync = promisify(execCallback)

/**
 * One call for every Start-menu entry on the machine.
 *
 * `-NoProfile -NonInteractive` for the same reasons as in `ea/hardware.ts`:
 * a user profile script would slow the call down and could write to stdout,
 * and nothing here may ever wait for input.
 */
const START_APPS_COMMAND =
  'powershell -NoProfile -NonInteractive -Command ' +
  '"Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"'

const defaultExec: ExecFn = async (command) => {
  const { stdout } = await execAsync(command, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/**
 * Package family name → AUMID.
 *
 * A Store game is activated through `shell:AppsFolder\<family>!<appId>`,
 * and the application id is declared in the package manifest — not in any
 * of the registry values the rest of this adapter reads. `Get-StartApps`
 * reports the finished identifier for every entry, which is one call rather
 * than one manifest read per package.
 *
 * Entries whose AppID is a file path are ordinary desktop programs and are
 * left out. Any failure gives an empty map: the adapter then falls back to
 * `<family>!App`, which is what the overwhelming majority of packages use.
 */
export async function readStartAppIds(exec?: ExecFn): Promise<Map<string, string>> {
  let output: string
  try {
    output = await (exec === undefined ? defaultExec(START_APPS_COMMAND) : exec(START_APPS_COMMAND))
  } catch {
    // No PowerShell, or not Windows at all — the same answer either way.
    return new Map()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return new Map()
  }

  // ConvertTo-Json emits a bare object when the pipeline held one item.
  const entries = Array.isArray(parsed) ? parsed : [parsed]

  const ids = new Map<string, string>()
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const appId = (entry as { AppID?: unknown }).AppID
    if (typeof appId !== 'string') continue

    const separator = appId.indexOf('!')
    // No '!' means a path to an executable, not a packaged app.
    if (separator <= 0) continue

    ids.set(appId.slice(0, separator), appId)
  }
  return ids
}
