import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { folderOf } from '@shared/executable'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'

export interface OtherAdapterDeps {
  /**
   * The storeless rows, read back from the database.
   *
   * Injected rather than queried, so this adapter stays free of the database
   * exactly as the others are, and can be tested with a plain array.
   */
  listStoreless: () => Game[]
  /** Whether the program is still on disk. Injected for tests. */
  fileExists: (path: string) => boolean
}

/**
 * The store for games that belong to no store.
 *
 * Everything else in `src/main/stores` reads a launcher's own records. This
 * one reads the rows Arcadia itself wrote, which is not circular by accident:
 * for a storeless game the user's own list **is** the catalogue. What it adds
 * over a bare database read is the part a catalogue is for — deciding whether
 * each entry is still there, and how to start it.
 */
export class OtherAdapter implements StoreAdapter {
  readonly id = 'other' as const
  readonly displayName = 'Other'

  private readonly listStoreless: OtherAdapterDeps['listStoreless']
  private readonly fileExists: OtherAdapterDeps['fileExists']

  constructor(deps: OtherAdapterDeps) {
    this.listStoreless = deps.listStoreless
    this.fileExists = deps.fileExists
  }

  async isAvailable(): Promise<AvailabilityResult> {
    // Always. There is no launcher to find, no registry key to read and no
    // account to hold — the entries are typed in by hand.
    return { available: true, limitations: [t().stores.other.handAdded] }
  }

  /**
   * Every storeless row, with its install state re-derived from the disk.
   *
   * Rows whose program has gone are **returned**, marked uninstalled, rather
   * than omitted. `upsertScan`'s mark-gone pass only touches rows absent from
   * a scan, and it reports each such row as newly uninstalled — omitting them
   * would announce the same transition on every scan from then on. Flipping
   * `installed` through the upsert says it once.
   *
   * `manual` travels with each row. Without it the first scan would clear the
   * mark and take the delete button with it, leaving entries that could never
   * be removed.
   */
  async scanInstalled(): Promise<RawGame[]> {
    return this.listStoreless().flatMap((game) => {
      const exe = game.launchExe
      // A storeless row without a program cannot exist by the repository's
      // own rule. Skipped rather than trusted, because a hand-edited database
      // is not worth crashing a scan of the whole library over.
      if (exe === undefined) return []

      return [
        {
          storeGameId: game.storeGameId,
          name: game.name,
          installed: this.fileExists(exe),
          // Set even when the file has gone: the folder usually still exists,
          // and "Open in file manager" is how someone finds out what moved.
          installPath: folderOf(exe),
          launchExe: exe,
          launchArgs: game.launchArgs ?? [],
          manual: true
        }
      ]
    })
  }

  /**
   * Starts the program directly.
   *
   * The same escape hatch the Microsoft Store adapter uses: returned as plain
   * data, so this file starts nothing itself and `launch-bridge.ts` stays the
   * only place a process begins.
   *
   * The working directory is the program's own folder. A Windows shortcut
   * behaves the same way, and a launcher that writes its logs or reads its
   * configuration relative to the working directory misbehaves without it.
   */
  launchCommand(game: Game): { exe: string; args: string[]; cwd: string } {
    const exe = game.launchExe
    if (exe === undefined) throw new Error(t().stores.other.noExecutable(game.name))
    // Checked at the moment of launching rather than trusting the last scan:
    // the file can go between the two, and the message names the path so the
    // user can see what moved.
    if (!this.fileExists(exe)) throw new Error(t().stores.other.fileMissing(exe))

    return { exe, args: game.launchArgs ?? [], cwd: folderOf(exe) }
  }

  /** Never reached — `launchCommand` above answers first. */
  launchUri(game: Game): string {
    throw new Error(t().stores.other.notLaunchable(game.name))
  }

  installUri(_game: Game): string {
    throw new Error(t().stores.other.nothingToInstall)
  }
}
