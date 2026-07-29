import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { readRegistryValue, type ExecFn } from '@main/platform/registry'

export interface FindSteamPathOptions {
  platform?: NodeJS.Platform
  homeDir?: string
  exec?: ExecFn
  exists?: (path: string) => Promise<boolean>
}

const defaultExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Order matters: native install before Flatpak before Snap.
 *
 * Deliberately `posix.join` rather than the ambient `join`: the latter is
 * bound to the **running** operating system, not to the one being checked.
 * On Windows, `join('/home/x', '.steam')` produced the path
 * `\home\x\.steam` — which would make the Linux branch untestable on a
 * Windows machine, defeating the entire purpose of the injected `platform`
 * option. Verified on the development machine.
 */
function linuxCandidates(home: string): string[] {
  return [
    posix.join(home, '.steam', 'steam'),
    posix.join(home, '.local', 'share', 'Steam'),
    posix.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
    posix.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam')
  ]
}

export async function findSteamPath(
  options: FindSteamPathOptions = {}
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? defaultExists

  if (platform === 'win32') {
    const raw = await readRegistryValue(
      'HKCU\\SOFTWARE\\Valve\\Steam',
      'SteamPath',
      options.exec
    )
    if (raw === undefined) return undefined
    // Steam writes the path with forward slashes into the registry — looked
    // up on the development machine.
    //
    // `win32.normalize` rather than `normalize`, for the same reason as the
    // Linux candidates: the ambient `normalize` would return the path
    // unchanged on Linux and make the Windows branch untestable there.
    const path = win32.normalize(raw)
    return (await exists(path)) ? path : undefined
  }

  const home = options.homeDir ?? homedir()
  for (const candidate of linuxCandidates(home)) {
    if (await exists(candidate)) return candidate
  }
  return undefined
}
