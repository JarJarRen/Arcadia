import type { DatabaseSync } from 'node:sqlite'
import { gameId, type Game, type RawGame, type StoreId } from '@shared/types'
import { manualStoreGameId, storeGameIdLooksValid } from '@shared/manual'
import { folderOf } from '@shared/executable'
import { t } from '@shared/i18n'
import type { MergeOverrides } from '@main/library/merge'

interface MergeOverrideRow {
  merge_key: string
  preferred_id: string | null
  split: number
}

export interface ScanDiff {
  added: number
  updated: number
  markedUninstalled: number
}

interface GameRow {
  id: string
  store_id: string
  store_game_id: string
  name: string
  installed: number
  install_path: string | null
  install_size: number | null
  playtime_minutes: number | null
  launch_id: string | null
  shared_or_free: number
  manual: number
  launch_exe: string | null
  launch_args: string | null
  last_played: number | null
  favorite: number
  hidden: number
  first_seen: number
  last_seen: number
}

/**
 * Reads the stored argument array.
 *
 * A malformed value yields no arguments rather than throwing: `all()` reads
 * the entire library through `toGame`, and one damaged row must not empty it.
 */
function parseLaunchArgs(value: string | null): string[] | undefined {
  if (value === null) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((part) => typeof part === 'string')
      ? (parsed as string[])
      : []
  } catch {
    return []
  }
}

function toGame(row: GameRow): Game {
  const launchArgs = parseLaunchArgs(row.launch_args)
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    storeGameId: row.store_game_id,
    name: row.name,
    installed: row.installed === 1,
    installPath: row.install_path ?? undefined,
    installSizeBytes: row.install_size ?? undefined,
    playtimeMinutes: row.playtime_minutes ?? undefined,
    launchId: row.launch_id ?? undefined,
    ...(row.shared_or_free === 1 ? { sharedOrFree: true } : {}),
    ...(row.manual === 1 ? { manual: true } : {}),
    ...(row.launch_exe === null ? {} : { launchExe: row.launch_exe }),
    ...(launchArgs === undefined ? {} : { launchArgs }),
    lastPlayed: row.last_played ?? undefined,
    favorite: row.favorite === 1,
    hidden: row.hidden === 1,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen
  }
}

export class GameRepository {
  constructor(private readonly db: DatabaseSync) {}

  all(): Game[] {
    const rows = this.db
      .prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE')
      .all() as unknown as GameRow[]
    return rows.map(toGame)
  }

  byId(id: string): Game | undefined {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as unknown as
      | GameRow
      | undefined
    return row ? toGame(row) : undefined
  }

  /**
   * The storeless rows, for the adapter that scans them.
   *
   * The adapter reading rows Arcadia itself wrote is not accidental: for this
   * store the user's own list **is** the catalogue.
   */
  storeless(): Game[] {
    const rows = this.db
      .prepare("SELECT * FROM games WHERE store_id = 'other' ORDER BY name COLLATE NOCASE")
      .all() as unknown as GameRow[]
    return rows.map(toGame)
  }

  setFavorite(id: string, value: boolean): void {
    this.db.prepare('UPDATE games SET favorite = ? WHERE id = ?').run(value ? 1 : 0, id)
  }

  /**
   * Records a game no adapter can see.
   *
   * `installed` stays 0 for the five real stores, and that is load-bearing
   * rather than incidental: `upsertScan` only marks games gone that are
   * currently installed, so a manual entry survives every scan of its store
   * untouched. The storeless store is the exception — see below.
   *
   * Giving a real store identifier is worthwhile where it is known. The row
   * then carries the same id an adapter would produce, so once the game is
   * installed for real the scan updates this very row and the placeholder
   * turns into an ordinary entry — keeping its favourite along the way.
   *
   * Returns the id, so the caller can select the new entry straight away.
   */
  addManualGame(
    game: {
      storeId: StoreId
      name: string
      storeGameId?: string
      launchExe?: string
      launchArgs?: string[]
    },
    now: number
  ): string {
    const name = game.name.trim()
    if (name === '') throw new Error('A game needs a name.')

    // Two mirrored rules. The storeless store is the only one with nothing to
    // launch through, so it is the only one that must carry a program — and
    // the only one that may. Without the second half this would quietly
    // become "attach a program to any game", which is a different feature
    // with a different question at its centre: what a later scan should do
    // to the row.
    if (game.storeId === 'other') {
      if (game.launchExe === undefined || game.launchExe.trim() === '') {
        throw new Error(t().errors.executableRequired)
      }
    } else if (game.launchExe !== undefined || game.launchArgs !== undefined) {
      throw new Error(t().errors.executableNotAllowed)
    }

    const supplied = game.storeGameId?.trim()
    if (supplied !== undefined && supplied !== '') {
      // The identifier travels into a launch URI and from there to the
      // shell. Checked here as well as in the adapter, because this is the
      // one path where the value is typed by a person.
      if (!storeGameIdLooksValid(game.storeId, supplied)) {
        throw new Error(`Not a valid ${game.storeId} identifier: ${supplied}`)
      }
    }

    const storeGameId =
      supplied === undefined || supplied === '' ? manualStoreGameId(name) : supplied
    const id = gameId(game.storeId, storeGameId)

    if (this.byId(id) !== undefined) {
      throw new Error(`${name} is already in the library.`)
    }

    // A storeless entry is installed at once: its file was picked from a
    // dialog and checked before reaching this layer, and an entry that read
    // "not installed" until the next sync would look broken. A hand-made
    // entry for a real store stays uninstalled, because there it describes
    // something Arcadia genuinely cannot see on disk.
    const exe = game.launchExe
    const installed = exe === undefined ? 0 : 1
    const installPath = exe === undefined ? null : folderOf(exe)

    this.db
      .prepare(
        `INSERT INTO games (
           id, store_id, store_game_id, name, installed, install_path, manual,
           launch_exe, launch_args, first_seen, last_seen
         ) VALUES (
           @id, @storeId, @storeGameId, @name, @installed, @installPath, 1,
           @launchExe, @launchArgs, @now, @now
         )`
      )
      .run({
        id,
        storeId: game.storeId,
        storeGameId,
        name,
        installed,
        installPath,
        launchExe: exe ?? null,
        launchArgs: game.launchArgs === undefined ? null : JSON.stringify(game.launchArgs),
        now
      })

    return id
  }

  /**
   * Deletes a manually added game.
   *
   * Refuses anything a scan found. Without that guard this channel would be
   * a way for the renderer to delete arbitrary library entries — the same
   * class of hole as accepting a path instead of a key in
   * `game:open-folder`.
   */
  removeManualGame(id: string): void {
    const game = this.byId(id)
    if (game === undefined) throw new Error(`Unknown game: ${id}`)
    if (game.manual !== true) {
      throw new Error(`${game.name} was found by a scan and cannot be deleted.`)
    }
    this.db.prepare('DELETE FROM games WHERE id = ? AND manual = 1').run(id)
  }

  /** Remembers which store a multiply-registered game launches through. */
  setPreferredStore(mergeKey: string, gameId: string | undefined): void {
    this.db
      .prepare(
        `INSERT INTO merge_overrides (merge_key, preferred_id, split)
         VALUES (@key, @id, 0)
         ON CONFLICT(merge_key) DO UPDATE SET preferred_id = excluded.preferred_id`
      )
      .run({ key: mergeKey, id: gameId ?? null })
    this.pruneMergeOverride(mergeKey)
  }

  /** Splits a key apart or puts it back together. */
  setSplit(mergeKey: string, split: boolean): void {
    this.db
      .prepare(
        `INSERT INTO merge_overrides (merge_key, preferred_id, split)
         VALUES (@key, NULL, @split)
         ON CONFLICT(merge_key) DO UPDATE SET split = excluded.split`
      )
      .run({ key: mergeKey, split: split ? 1 : 0 })
    this.pruneMergeOverride(mergeKey)
  }

  readMergeOverrides(): MergeOverrides {
    const rows = this.db
      .prepare('SELECT merge_key, preferred_id, split FROM merge_overrides')
      .all() as unknown as MergeOverrideRow[]

    const preferred: Record<string, string> = {}
    const split = new Set<string>()
    for (const row of rows) {
      if (row.preferred_id !== null) preferred[row.merge_key] = row.preferred_id
      if (row.split === 1) split.add(row.merge_key)
    }
    return { preferred, split }
  }

  /**
   * Removes a row that holds neither a store choice nor a split. Without
   * this, empty rows would accumulate over time as a user takes their
   * decisions back.
   */
  private pruneMergeOverride(mergeKey: string): void {
    this.db
      .prepare(
        'DELETE FROM merge_overrides WHERE merge_key = ? AND preferred_id IS NULL AND split = 0'
      )
      .run(mergeKey)
  }

  /**
   * Writes the result of a store scan.
   *
   * Two properties are deliberate:
   *
   * 1. Games that no longer appear are set to `installed = 0` rather than
   *    deleted — otherwise favourites and (from plan 3) manual metadata
   *    matches would be lost on every uninstall.
   * 2. Optional fields are only overwritten via COALESCE when the scan
   *    supplies a value. The local manifest scan knows no playtime; without
   *    COALESCE it would wipe the values from the Web API scan.
   */
  upsertScan(storeId: StoreId, games: RawGame[], now: number): ScanDiff {
    const ids = (sql: string): Set<string> =>
      new Set(
        (this.db.prepare(sql).all(storeId) as unknown as Array<{ id: string }>).map(
          (row) => row.id
        )
      )

    // Two differently scoped sets, deliberately kept apart:
    //   existing  — everything ever seen, decides "added or updated"
    //   installed — only what is currently installed, decides who vanished
    // With a single set the mark-gone loop would run over long-uninstalled
    // games on every scan: last_seen would lose its meaning, and
    // markedUninstalled would report the same games forever instead of only
    // at the actual transition.
    const existing = ids('SELECT id FROM games WHERE store_id = ?')
    const installed = ids('SELECT id FROM games WHERE store_id = ? AND installed = 1')

    const insert = this.db.prepare(`
      INSERT INTO games (
        id, store_id, store_game_id, name, installed, install_path,
        install_size, playtime_minutes, last_played, launch_id, shared_or_free,
        manual, launch_exe, launch_args,
        first_seen, last_seen
      ) VALUES (
        @id, @storeId, @storeGameId, @name, @installed, @installPath,
        @installSize, @playtime, @lastPlayed, @launchId, @sharedOrFree,
        @manual, @launchExe, @launchArgs,
        @now, @now
      )
      ON CONFLICT(id) DO UPDATE SET
        name             = excluded.name,
        installed        = excluded.installed,
        install_path     = COALESCE(excluded.install_path, games.install_path),
        install_size     = COALESCE(excluded.install_size, games.install_size),
        playtime_minutes = COALESCE(excluded.playtime_minutes, games.playtime_minutes),
        last_played      = COALESCE(excluded.last_played, games.last_played),
        launch_id        = COALESCE(excluded.launch_id, games.launch_id),
        -- Not COALESCE: if the API later reports the game as licensed, the
        -- mark has to disappear again. With COALESCE it would stay forever
        -- once it had been set.
        shared_or_free   = excluded.shared_or_free,
        -- Taken from the scanned row rather than forced to 0. A scan that
        -- finds a game still claims the row — no adapter sets this field, so
        -- every store but 'other' writes 0 exactly as before. The storeless
        -- store is the one that scans its own hand-made rows, and stripping
        -- the mark there would take away their delete button forever.
        manual           = excluded.manual,
        launch_exe       = COALESCE(excluded.launch_exe, games.launch_exe),
        launch_args      = COALESCE(excluded.launch_args, games.launch_args),
        last_seen        = excluded.last_seen
    `)

    const markGone = this.db.prepare(
      'UPDATE games SET installed = 0, last_seen = ? WHERE id = ?'
    )

    const diff: ScanDiff = { added: 0, updated: 0, markedUninstalled: 0 }

    // node:sqlite has no db.transaction() like better-sqlite3 — the
    // transaction is bracketed by hand. Without the ROLLBACK the database
    // would stay half-written after an abort mid-scan.
    this.db.exec('BEGIN')
    try {
      const seen = new Set<string>()

      for (const game of games) {
        const id = gameId(storeId, game.storeGameId)

        // The same game can appear more than once in one scan, for instance
        // via two library paths. Only the first hit is counted — otherwise
        // the diff reports more games than rows actually created.
        if (!seen.has(id)) {
          if (existing.has(id)) diff.updated++
          else diff.added++
          seen.add(id)
        }

        insert.run({
          id,
          storeId,
          storeGameId: game.storeGameId,
          name: game.name,
          installed: game.installed ? 1 : 0,
          installPath: game.installPath ?? null,
          installSize: game.installSizeBytes ?? null,
          playtime: game.playtimeMinutes ?? null,
          lastPlayed: game.lastPlayed ?? null,
          launchId: game.launchId ?? null,
          sharedOrFree: game.sharedOrFree === true ? 1 : 0,
          manual: game.manual === true ? 1 : 0,
          launchExe: game.launchExe ?? null,
          launchArgs: game.launchArgs === undefined ? null : JSON.stringify(game.launchArgs),
          now
        })
      }

      // Over `installed`, not over `existing`: only the actual transition
      // from installed to gone is written and counted.
      for (const id of installed) {
        if (!seen.has(id)) {
          markGone.run(now, id)
          diff.markedUninstalled++
        }
      }

      this.db.exec('COMMIT')
    } catch (error) {
      // Best effort: a failing ROLLBACK must not overwrite the actual
      // cause. Without this inner try its exception would replace `error`,
      // and the connection would be left inside an open transaction — the
      // next scan would then break immediately at `BEGIN`, with a message
      // bearing no relation to the cause.
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // deliberately swallowed
      }
      throw error
    }

    return diff
  }
}
