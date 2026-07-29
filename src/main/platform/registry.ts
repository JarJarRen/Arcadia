import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execCallback)

export type ExecFn = (command: string) => Promise<string>

const defaultExec: ExecFn = async (command) => {
  const { stdout } = await execAsync(command, { windowsHide: true })
  return stdout
}

/**
 * Forces UTF-8 for the output of `reg.exe`.
 *
 * Without it, `reg.exe` converts characters missing from the console code
 * page **lossily**: "STAR WARS Jedi: Fallen Order™" becomes "… OrderT" —
 * the raw byte really is `0x54`, an actual capital T. No amount of
 * re-encoding afterwards can repair that, because the information is
 * already lost inside `reg.exe`.
 *
 * Verified on the development machine: with `chcp 65001` in front, U+2122
 * arrives intact. This mainly affects EA and Ubisoft names, which
 * frequently carry ™ and ®.
 */
function utf8(command: string): string {
  return `chcp 65001 >nul && ${command}`
}

/**
 * Parses the output of `reg query`.
 *
 * Deliberately not a native registry module: native Node modules have to
 * be recompiled for every Electron version. Parsing `reg query` is uglier
 * but needs less maintenance — and only ever runs on Windows anyway.
 */
export function parseRegQueryOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    // Value lines are indented: <name> <REG_TYPE> <value>
    const match = /^\s+(\S+)\s+(REG_\w+)\s+(.*)$/.exec(line)
    if (!match) continue
    const [, name, , value] = match
    if (name !== undefined && value !== undefined) values[name] = value.trim()
  }
  return values
}

export async function readRegistryValue(
  keyPath: string,
  valueName: string,
  exec: ExecFn = defaultExec
): Promise<string | undefined> {
  try {
    const output = await exec(utf8(`reg query "${keyPath}" /v "${valueName}"`))
    // `reg query /v <name>` echoes the name back the way it was asked for,
    // not the way it is stored — verified on the development machine. So a
    // direct lookup is enough here. Reading a whole key, by contrast,
    // returns the real spelling and needs `findValue`.
    return parseRegQueryOutput(output)[valueName]
  } catch {
    // A missing key is the normal case when a store is not installed — no
    // reason to propagate an exception.
    return undefined
  }
}

/**
 * Reads every value of a key in one go.
 *
 * Unlike `readRegistryValue`, this returns the **actual** spelling of the
 * value names. Observed on the development machine: Ubisoft writes
 * `InstallDir` for one game and `installdir` for the next; EA writes
 * `DisplayName` sometimes and `displayname` other times. Access therefore
 * goes exclusively through `findValue`.
 */
export async function readRegistryValues(
  keyPath: string,
  exec: ExecFn = defaultExec
): Promise<Record<string, string>> {
  try {
    return parseRegQueryOutput(await exec(utf8(`reg query "${keyPath}"`)))
  } catch {
    return {}
  }
}

/** Value lookup that ignores case. */
export function findValue(
  values: Record<string, string>,
  name: string
): string | undefined {
  const direct = values[name]
  if (direct !== undefined) return direct
  const lower = name.toLowerCase()
  for (const key of Object.keys(values)) {
    if (key.toLowerCase() === lower) return values[key]
  }
  return undefined
}

/**
 * Reads a whole registry subtree with **one** call.
 *
 * `reg query <key> /s` prints every subkey along with its values,
 * separated by blank lines before each `HKEY_` line. For trees with many
 * subkeys — `Uninstall`, for instance — that is the only viable route: one
 * query per key would start hundreds of processes.
 */
export async function readRegistryTree(
  keyPath: string,
  exec: ExecFn = defaultExec
): Promise<Array<Record<string, string>>> {
  let output: string
  try {
    output = await exec(utf8(`reg query "${keyPath}" /s`))
  } catch {
    return []
  }

  const levels = keyPath.split('\\').length
  return output
    .split(/\r?\n(?=HKEY_)/)
    .filter((block) => block.trim().split('\\').length > levels)
    .map((block) => parseRegQueryOutput(block))
}

/** Lists a key's subkeys, each as a full path. */
export async function readRegistrySubKeys(
  keyPath: string,
  exec: ExecFn = defaultExec
): Promise<string[]> {
  try {
    const output = await exec(utf8(`reg query "${keyPath}"`))

    // Filter by the number of path segments, not by string length: the
    // query uses the short form `HKLM`, while the output uses the long form
    // `HKEY_LOCAL_MACHINE`. A length comparison would therefore let the
    // queried key itself slip through. Both spellings count as exactly one
    // segment.
    const levels = keyPath.split('\\').length
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) => line.toUpperCase().startsWith('HKEY_') && line.split('\\').length > levels
      )
  } catch {
    return []
  }
}
