import { win32 } from 'node:path'

/**
 * Root of the machine-wide data directory on Windows.
 *
 * Until recently `C:\ProgramData` sat hard-wired in three places. That is
 * right on the vast majority of machines — but not on all of them: with
 * Windows on a different drive the path points nowhere, and Epic would be
 * undiscoverable without anything looking like an error.
 *
 * `PROGRAMDATA` is set by Windows itself. The fixed path remains as a
 * fallback: if the variable is missing, the guess still beats nothing.
 */
export function programDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PROGRAMDATA
  return configured !== undefined && configured !== '' ? configured : 'C:\\ProgramData'
}

/**
 * Epic's data directory on Windows.
 *
 * `win32.join` rather than the ambient `join`: the latter follows the
 * running operating system and would produce `C:\ProgramData/Epic/…` with
 * mixed separators on Linux. That would make this branch untestable on a
 * Linux machine — the same reason as for the Steam paths.
 */
export function epicDataDir(env?: NodeJS.ProcessEnv): string {
  return win32.join(programDataDir(env), 'Epic', 'EpicGamesLauncher', 'Data')
}

/** Manifests of the installed games. */
export function epicManifestDir(env?: NodeJS.ProcessEnv): string {
  return win32.join(epicDataDir(env), 'Manifests')
}

/** Cache of the owned library — see catalog.ts. */
export function epicCatalogFile(env?: NodeJS.ProcessEnv): string {
  return win32.join(epicDataDir(env), 'Catalog', 'catcache.bin')
}
