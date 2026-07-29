import { win32 } from 'node:path'

/**
 * Where to look for the `.env` holding the API keys.
 *
 * `dotenv` on its own reads from the working directory. That is right when
 * Arcadia is started from its checkout and wrong for an installed copy,
 * whose working directory is whatever the shortcut happened to point at —
 * so a packaged build would quietly run with no keys at all, showing
 * installed games only and no artwork from SteamGridDB.
 *
 * Two places are tried, in this order:
 *
 *  1. the working directory, which keeps `npm run dev` behaving as before;
 *  2. `userData`, the folder that already holds `arcadia.db`. It is always
 *     writable, always in the same place, and does not need administrator
 *     rights the way `C:\Program Files` would.
 *
 * Keys belong in the settings interface eventually — spec section 11.3 has
 * described that since the beginning and it has never been built. Until
 * then this is the difference between a distributable app that can reach
 * Steam and one that cannot.
 */
export function envFileCandidates(paths: { cwd: string; userData?: string }): string[] {
  const candidates = [win32.join(paths.cwd, '.env')]

  if (paths.userData !== undefined && paths.userData !== '') {
    const beside = win32.join(paths.userData, '.env')
    // Starting the app from its own data folder would otherwise name the
    // same file twice.
    if (!candidates.includes(beside)) candidates.push(beside)
  }

  return candidates
}
