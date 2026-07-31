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

/**
 * Which of the candidates the configuration screen writes to.
 *
 * The first that exists, and the last — `userData` — when none does.
 *
 * Not simply always `userData`: `envFileCandidates` ranks the working
 * directory first and dotenv loads it first, so writing beside the database
 * while a checkout's `.env` exists would leave the saved keys shadowed by
 * the older file and apparently ignored. And not always the working
 * directory either: an installed copy sits in `C:\Program Files`, where
 * writing needs administrator rights.
 *
 * `exists` is injected so the choice can be tested without a filesystem.
 */
export function envTargetPath(candidates: string[], exists: (path: string) => boolean): string {
  const found = candidates.find(exists)
  if (found !== undefined) return found
  return candidates[candidates.length - 1] ?? ''
}

/** `KEY=value`, with the key captured. Comment lines never match. */
const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

/**
 * Every `KEY=value` pair in a `.env`.
 *
 * Deliberately not dotenv's own parser: dotenv reads a file and mutates
 * `process.env`, while this reads text and returns it. The configuration
 * screen edits the file, not the environment of the running process — an
 * inherited `STEAM_ID64` from the machine is not Arcadia's to write into
 * anybody's file.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of text.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line)
    // Only the FIRST '=' separates; the rest belongs to the value. Keys
    // ending in '=' are ordinary base64 padding.
    if (match !== null) values[match[1] as string] = (match[2] as string).trim()
  }

  return values
}

/**
 * The longest a value may be.
 *
 * Steam's key is 32 characters, SteamGridDB's 40, a SteamID64 is 17. 200
 * leaves room for a format nobody has seen yet while keeping a stray
 * paste — a whole file, a stack trace — out of the settings.
 */
const MAX_VALUE_LENGTH = 200

/** Whether a value can be written to a `.env` at all. */
export function envValueIsWritable(value: string): boolean {
  if (value.length > MAX_VALUE_LENGTH) return false
  // A line break would end the assignment and turn the rest into a variable
  // of its own — arbitrary settings injected through a text field.
  return !/[\r\n]/.test(value)
}

/**
 * The file's new contents, with the given keys set.
 *
 * Lines are replaced where they stand and missing keys appended; comments,
 * blank lines, ordering and variables Arcadia knows nothing about survive
 * untouched. Rewriting from a template instead would delete the explanations
 * every `.env` inherits from `.env.example` — including the URLs the keys
 * are obtained from, which exist nowhere else once the copy is made.
 */
export function applyEnvValues(text: string, values: Record<string, string>): string {
  for (const [key, value] of Object.entries(values)) {
    if (!envValueIsWritable(value)) {
      throw new Error(`Value for ${key} cannot be written to a .env file.`)
    }
  }

  const pending = new Set(Object.keys(values))

  const lines = text.split(/\r?\n/).map((line) => {
    const match = ASSIGNMENT.exec(line)
    const key = match?.[1]
    if (key === undefined || !pending.has(key)) return line
    pending.delete(key)
    return `${key}=${values[key] as string}`
  })

  // Trailing blank lines would otherwise push the appended keys away from
  // the rest of the file, one gap wider on every save.
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()

  for (const key of pending) lines.push(`${key}=${values[key] as string}`)

  return `${lines.join('\n')}\n`
}
