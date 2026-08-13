/**
 * What is wrong with a chosen path, or nothing.
 *
 * Returns a reason rather than a message so the caller decides the wording —
 * the same reason reaches the picker and the IPC validator, which say it
 * differently.
 */
export type ExecutableProblem = 'notAbsolute' | 'unsupportedType'

/**
 * Mirrors `NodeJS.Platform`'s literal values rather than importing them.
 *
 * `@types/node` is not part of the web project's compile (see the module
 * comment), so the ambient `NodeJS` namespace does not exist there. This
 * type is structurally identical to `NodeJS.Platform`, so a `process.platform`
 * value — typed `NodeJS.Platform` wherever the main process calls in —
 * passes here without a cast.
 */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

/**
 * Checks a path without touching the disk.
 *
 * Existence is deliberately **not** checked here: that needs I/O, and this
 * runs in places that have none. The caller stats separately.
 *
 * On Windows the file must be a `.exe`, which refuses three kinds of path
 * worth naming. A `.lnk` cannot be spawned at all — it has to be resolved to
 * its target first, which the picker does, so anything still carrying that
 * extension by the time it gets here was never resolved. `.bat` and `.cmd`
 * need a shell interpreter, and passing a user-supplied path through a shell
 * is what the argument array exists to avoid. Everything else is simply not a
 * program.
 *
 * Away from Windows there is no meaningful extension rule, so only the
 * absolute-path requirement applies.
 */
export function executableProblem(
  path: string,
  platform: Platform
): ExecutableProblem | undefined {
  // Answered for the target platform, not for the host running this code.
  const absolute =
    platform === 'win32' ? /^([A-Za-z]:[\\/]|\\\\)/.test(path) : path.startsWith('/')
  if (!absolute) return 'notAbsolute'

  if (platform !== 'win32') return undefined

  // One check, not a list of refused extensions beside it: an allow-list of
  // exactly `.exe` already excludes every one of them, and a second list would
  // only be somewhere for the two to disagree.
  if (extensionOf(path) !== '.exe') return 'unsupportedType'
  return undefined
}

/** The last path segment, for either separator. */
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/** The extension including its dot, lowercased, or an empty string. */
function extensionOf(path: string): string {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  // A leading dot is a hidden file, not an extension.
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/** Whether the path is a Windows shortcut needing resolution. */
export function isShortcut(path: string): boolean {
  return extensionOf(path) === '.lnk'
}

/**
 * The folder a file sits in.
 *
 * Decided by the separator the path itself uses rather than by the host's,
 * which is what makes a `C:\…` path answer correctly on the Linux box that
 * runs CI. A file in the root keeps its root.
 *
 * Cuts at the last occurrence of *either* separator, since a path can mix
 * them — `executableProblem`'s absolute-path check and `fileNameOf`'s split
 * both accept `\` and `/`, so a mixed path reaches here unrejected.
 *
 * Assumes an absolute path: a relative one such as `mc.exe` has no separator
 * to cut at and answers `''`, but rejecting that is `executableProblem`'s
 * job, not this function's.
 */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (cut === -1) return ''
  // `C:\mc.exe` → `C:\`, `/launcher` → `/`. Cutting at `cut` alone would
  // leave `C:` and `''`, neither of which is a directory.
  return cut === 0 || path[cut - 1] === ':' ? path.slice(0, cut + 1) : path.slice(0, cut)
}

/**
 * Splits a typed argument line into an argument array.
 *
 * Double quotes group, everything else is literal. There is no escaping and
 * no variable expansion, because there is no shell — the result goes straight
 * into `spawn`'s array, where `&` and `|` are ordinary characters.
 */
export function parseArguments(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  let started = false

  for (const character of text) {
    if (character === '"') {
      quoted = !quoted
      // An empty pair of quotes is a real, empty argument.
      started = true
      continue
    }
    if (!quoted && /\s/.test(character)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }

  if (started) args.push(current)
  return args
}

/** A first guess at the game's name, from the file it starts. */
export function defaultNameFor(path: string): string {
  const name = fileNameOf(path)
  const extension = extensionOf(name)
  return extension === '' ? name : name.slice(0, -extension.length)
}
