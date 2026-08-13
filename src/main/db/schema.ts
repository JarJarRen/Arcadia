import { renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  -- NOT NULL is not redundant here: for non-INTEGER primary keys SQLite
  -- does not enforce it by itself, for historical reasons, so several NULL
  -- rows could otherwise sit side by side.
  id               TEXT PRIMARY KEY NOT NULL,
  store_id         TEXT NOT NULL,
  store_game_id    TEXT NOT NULL,
  name             TEXT NOT NULL,
  installed        INTEGER NOT NULL DEFAULT 0,
  install_path     TEXT,
  install_size     INTEGER,
  playtime_minutes INTEGER,
  launch_id        TEXT,
  -- The program a storeless game starts, and its arguments as a JSON array.
  -- Only the \`other\` store fills these; every adapter-backed game launches
  -- through a URI or a store command instead.
  launch_exe       TEXT,
  launch_args      TEXT,
  -- Playable, but not licensed to this account. See shared/types.ts.
  shared_or_free   INTEGER NOT NULL DEFAULT 0,
  -- Added by hand for a game no adapter can see. EA used to be the reason:
  -- it reported only what had been installed here. The adapter now reads the
  -- entitlement store instead, but offers EA's catalogue neither names nor
  -- classifies are still dropped, and this remains the way to enter them.
  manual           INTEGER NOT NULL DEFAULT 0,
  last_played      INTEGER,
  favorite         INTEGER NOT NULL DEFAULT 0,
  hidden           INTEGER NOT NULL DEFAULT 0,
  first_seen       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_store ON games(store_id);
CREATE INDEX IF NOT EXISTS idx_games_name  ON games(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The user's decisions about merging multiply-registered games. The key is
-- the normalised name, not a game ID: that way the choice survives a
-- reinstall or a change of store.
--
-- preferred_id is deliberately nullable: an entry can be split without any
-- store being preferred.
CREATE TABLE IF NOT EXISTS merge_overrides (
  merge_key    TEXT PRIMARY KEY NOT NULL,
  preferred_id TEXT,
  split        INTEGER NOT NULL DEFAULT 0
);

-- Metadata per game. Lists are stored as JSON text: SQLite has no list
-- type, and separate tables for values that are always read in full would
-- be needless machinery.
--
-- fetch_attempts bounds the retries. A game Steam simply does not know
-- must not be queried again on every start.
CREATE TABLE IF NOT EXISTS metadata (
  game_id           TEXT PRIMARY KEY NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  steam_appid       INTEGER,
  match_source      TEXT,
  short_description TEXT,
  description       TEXT,
  developers        TEXT,
  publishers        TEXT,
  genres            TEXT,
  release_date      TEXT,
  metacritic        INTEGER,
  screenshots       TEXT,
  fetched_at        INTEGER,
  fetch_failed_at   INTEGER,
  fetch_attempts    INTEGER NOT NULL DEFAULT 0,
  -- Counted separately from fetch_attempts: a game can have complete
  -- metadata and still sit there without an image. Measured at 17 of 239 —
  -- for those, SteamGridDB has a go.
  artwork_attempts  INTEGER NOT NULL DEFAULT 0
);

-- The parts of the metadata that differ by language, one row per language.
--
-- Kept apart from the metadata table so both languages can coexist:
-- switching the interface language then costs nothing once each language has
-- been fetched once, instead of discarding and refetching the other every
-- time.
--
-- Screenshots, developers, publishers and the Metacritic score are NOT here.
-- They do not differ by language, and duplicating the screenshot list would
-- double the largest column in the schema for no gain.
--
-- fetched_at here means "when this language's text was fetched" and is
-- distinct from metadata.fetched_at, which covers the language-independent
-- part and governs fetch_attempts.
CREATE TABLE IF NOT EXISTS metadata_text (
  game_id           TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  language          TEXT NOT NULL,
  short_description TEXT,
  description       TEXT,
  genres            TEXT,
  release_date      TEXT,
  fetched_at        INTEGER,
  PRIMARY KEY (game_id, language)
);

-- No local_path column: images are not downloaded but loaded straight from
-- the source. See shared/metadata.ts.
CREATE TABLE IF NOT EXISTS artwork (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  url     TEXT NOT NULL,
  PRIMARY KEY (game_id, kind)
);

/**
 * The cached free-games list.
 *
 * Rewritten wholesale on every successful refresh, so an ended promotion
 * disappears without a separate expiry job. A failed refresh leaves the
 * previous contents alone, which is what makes the page usable offline.
 */
CREATE TABLE IF NOT EXISTS freebies (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  store_game_id TEXT,
  claim_url     TEXT,
  image_url     TEXT,
  starts_at     INTEGER,
  ends_at       INTEGER,
  source        TEXT NOT NULL,
  seen_at       INTEGER NOT NULL
);

/**
 * What the user has already opened, and what has since turned up.
 *
 * A separate table so a claim outlives the promotion that produced it: a
 * game claimed last Thursday should still read as claimed after the
 * giveaway ends and its freebies row is gone.
 */
CREATE TABLE IF NOT EXISTS freebie_claims (
  freebie_id   TEXT PRIMARY KEY,
  opened_at    INTEGER NOT NULL,
  confirmed_at INTEGER
);
`

/**
 * Columns added after the first version.
 *
 * Necessary because `CREATE TABLE IF NOT EXISTS` never alters an
 * **existing** table: for a user who had already started the app once, the
 * new column simply was not there and every scan failed with "table games
 * has no column named …". That is exactly what happened when `launch_id`
 * was introduced.
 *
 * Table and column names are constants here and never come from outside —
 * ALTER TABLE permits no placeholders for them.
 */
const MIGRATIONS: ReadonlyArray<{ table: string; column: string; definition: string }> = [
  { table: 'games', column: 'launch_id', definition: 'TEXT' },
  // Without this record the app would run against the same hopeless cases
  // on every start — measured, that is two out of 17.
  { table: 'metadata', column: 'artwork_attempts', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // Playable but not licensed — family sharing or free-to-play.
  { table: 'games', column: 'shared_or_free', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // Added by hand, not found by any adapter. Marks the rows that may be
  // deleted again, and the ones a scan must leave alone.
  { table: 'games', column: 'manual', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // The program a storeless game starts. Absent for every other store.
  { table: 'games', column: 'launch_exe', definition: 'TEXT' },
  // Its arguments, as a JSON array. Stored already split, so nothing is
  // re-parsed — and never handed to a shell.
  { table: 'games', column: 'launch_args', definition: 'TEXT' }
]

function migrate(db: DatabaseSync): void {
  for (const { table, column, definition } of MIGRATIONS) {
    const columns = (
      db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as unknown as Array<{
        name: string
      }>
    ).map((row) => row.name)

    // If the table is missing entirely, SCHEMA has just created it with
    // every column — then there is nothing to do.
    if (columns.length === 0 || columns.includes(column)) continue
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/**
 * Moves text written before `metadata_text` existed into it, as German.
 *
 * The code that wrote those rows requested `l=german` from Steam without a
 * choice, so German is the correct label for everything that predates the
 * language switch.
 *
 * **This cannot be proven row by row.** A row fetched after the interface
 * was translated would hold English text under the `de` label and would read
 * as English while the interface is German — until that game is fetched
 * again, which overwrites it correctly. That is a cosmetic mislabelling, and
 * it is the reason this backfill was preferred over discarding the text and
 * refetching all of it.
 *
 * The old columns in `metadata` stay where they are. Dropping them would
 * mean rebuilding the table, and they cost nothing.
 *
 * Guarded so it cannot run twice: once any text row exists, the migration is
 * done, and a second pass would overwrite text that has since been fetched
 * properly.
 */
/**
 * Whether a table really has these columns.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters a table that is already there,
 * so a database written by an older plan keeps its old shape and a statement
 * naming a newer column fails with "no such column". Plan 3's `metadata`
 * carried only game_id, steam_appid, match_source and fetch_attempts — the
 * migration test builds exactly that one, and it has now caught this twice.
 */
function hasColumns(db: DatabaseSync, table: string, columns: string[]): boolean {
  const present = new Set(
    (
      db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as unknown as Array<{
        name: string
      }>
    ).map((row) => row.name)
  )
  return columns.every((column) => present.has(column))
}

function backfillMetadataText(db: DatabaseSync): void {
  const existing = db
    .prepare('SELECT COUNT(*) AS n FROM metadata_text')
    .get() as unknown as { n: number }
  if (existing.n > 0) return

  // A database old enough to predate the text columns has nothing to move,
  // and reading them would fail with "no such column".
  if (!hasColumns(db, 'metadata', ['short_description', 'description', 'genres', 'release_date'])) {
    return
  }

  db.exec(`
    INSERT INTO metadata_text (
      game_id, language, short_description, description, genres, release_date, fetched_at
    )
    SELECT game_id, 'de', short_description, description, genres, release_date, fetched_at
    FROM metadata
    WHERE short_description IS NOT NULL
       OR description IS NOT NULL
       OR genres IS NOT NULL
       OR release_date IS NOT NULL
  `)
}

/**
 * Runs a repair at most once over the life of a database.
 *
 * The marker goes in the settings table rather than being inferred from the
 * data, because the condition a repair looks for is usually still true
 * afterwards: a game Steam reports no header for still has no hero. Inferred,
 * the repair would re-fetch it on every start of the app forever.
 */
export function runOnce(
  db: DatabaseSync,
  key: string,
  repair: (db: DatabaseSync) => number
): void {
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (done !== undefined) return
  // The marker is written only when the repair actually changed something.
  // Otherwise every start of a database with nothing to repair — a fresh
  // install, or any test that opens one — would write a row it does not
  // need, and on Windows that leaves the WAL and shm files behind for the
  // next process to trip over.
  if (repair(db) > 0) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, 'done')
  }
}

/**
 * Gives games fetched before the header fix a second chance at their hero.
 *
 * Steam serves nothing at the derived `/apps/<appid>/header.jpg` for titles
 * on its hashed asset path — measured on AppID 3949040 across all four CDN
 * hosts. The queue now takes the URL the store reports instead, but only
 * while fetching, and `pendingGameIds` requires `fetched_at IS NULL`: a game
 * fetched before the fix would never be looked at again.
 *
 * Clearing `fetched_at` puts it back in the queue. The text in
 * `metadata_text` stays where it is, so nothing that cost a request is lost —
 * the next pass overwrites it with the same content.
 *
 * Only games with an AppID: without one there is no store entry that could
 * report a header, and the pass would spend an attempt to learn nothing.
 *
 * `openDatabase` runs this through `runOnce`; called directly it repairs
 * unconditionally. Returns how many games it reopened, which is what decides
 * whether the repair needs recording as done.
 */
export function repairHeroGaps(db: DatabaseSync): number {
  // Nothing to reopen in a database whose metadata table predates these
  // columns: it holds no fetch timestamps at all.
  if (!hasColumns(db, 'metadata', ['fetched_at', 'steam_appid'])) return 0

  const result = db
    .prepare(
      `UPDATE metadata SET fetched_at = NULL
       WHERE steam_appid IS NOT NULL
         AND fetched_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM artwork a WHERE a.game_id = metadata.game_id AND a.kind = 'hero'
         )`
    )
    .run()
  return Number(result.changes)
}

/**
 * SQLite result codes for a file that reopening cannot mend.
 *
 * 11 is SQLITE_CORRUPT ("database disk image is malformed"), 26 is
 * SQLITE_NOTADB ("file is not a database"). Matched on `errcode` rather than
 * on the message, because the message is English prose that SQLite is free to
 * reword. Verified against a genuinely corrupted file: `node:sqlite` throws an
 * Error carrying `code: 'ERR_SQLITE_ERROR'` and `errcode: 11`.
 */
const UNUSABLE_FILE_ERRCODES = new Set([11, 26])

/** What `openDatabase` reports when it had to set a damaged file aside. */
export interface DatabaseRecovery {
  /** Where the unusable file was kept. Nothing is ever deleted. */
  movedTo: string
}

function isUnusableFile(error: unknown): boolean {
  const errcode = (error as { errcode?: unknown } | null)?.errcode
  return typeof errcode === 'number' && UNUSABLE_FILE_ERRCODES.has(errcode)
}

/**
 * Renames the database and its sidecars out of the way.
 *
 * The `-wal` and `-shm` files have to travel with it. Left behind, SQLite
 * would replay the old write-ahead log into the newly created database and
 * corrupt that one too — the failure would look like it had followed the app
 * through a reinstall.
 *
 * Returns where the database itself went, which is what the user is told.
 */
function setAside(path: string, stamp: string): string {
  const movedTo = `${path}.corrupt-${stamp}`
  renameSync(path, movedTo)

  for (const suffix of ['-wal', '-shm']) {
    // Best effort: a missing sidecar is the normal case, and a locked one
    // must not stop the recovery that is already under way.
    try {
      renameSync(`${path}${suffix}`, `${movedTo}${suffix}`)
    } catch {
      // Nothing to move, or nothing that can be moved. Either is survivable.
    }
  }

  return movedTo
}

/**
 * Adds `other` to a store choice made before that store existed.
 *
 * `enabled-stores` holds an explicit list. Anyone who had ever opened the
 * store settings therefore had a saved list that could not contain `other`,
 * so the new store would have arrived switched **off** — and since the add
 * dialog only offers enabled stores, the feature would have been invisible
 * to exactly the people who had configured the app.
 *
 * Deliberately **not** routed through `runOnce`: that records a repair only
 * when it changed something, so a user who later switched the storeless
 * store back off would have it switched on again at every start, forever.
 * The marker here is written unconditionally, which is what makes this run
 * exactly once over the life of a database.
 *
 * An empty value is left alone. It means "no store at all", which is a real
 * choice rather than an absent one, and adding a store to it would override
 * a decision rather than complete one.
 *
 * The comma handling is deliberately not `parseEnabledStores` /
 * `serializeEnabledStores` from shared/stores.ts, though they parse the same
 * setting. Those filter the value against the **running** version's
 * `STORE_IDS`, which is right for reading a setting and wrong here: this walks
 * over databases written by other versions, and an id this build has never
 * heard of would be silently dropped from a list it was only meant to append
 * one entry to.
 */
function migrateEnabledStoresForOther(db: DatabaseSync): void {
  const MARKER = 'migrate:enabled-stores-other'
  if (db.prepare('SELECT value FROM settings WHERE key = ?').get(MARKER) !== undefined) return

  const row = db.prepare("SELECT value FROM settings WHERE key = 'enabled-stores'").get() as
    | { value: string }
    | undefined

  if (row !== undefined && row.value !== '') {
    const stores = row.value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
    if (!stores.includes('other')) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'enabled-stores'").run(
        [...stores, 'other'].join(',')
      )
    }
  }

  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(MARKER, 'done')
}

/**
 * Opens and prepares a database, leaving no handle behind if it fails.
 *
 * `new DatabaseSync` succeeds even on a corrupt file — the throw comes later,
 * from the first statement that has to read a page. The close in the catch is
 * therefore load-bearing rather than tidiness: Windows will not rename a file
 * that is still open, and setting the damaged one aside is exactly what the
 * caller is about to try.
 */
function prepare(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    // node:sqlite has no db.pragma() — PRAGMAs go through exec().
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(SCHEMA)
    migrate(db)
    backfillMetadataText(db)
    migrateEnabledStoresForOther(db)
    runOnce(db, 'repair:hero-gaps', repairHeroGaps)
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      // Too broken to close. The rename that follows is the real test of
      // whether the handle was released.
    }
    throw error
  }
}

/**
 * Opens the database, surviving a file that has been damaged.
 *
 * A corrupt database used to be fatal in a way that was almost impossible to
 * read: the throw happened partway through `app.whenReady()`, so
 * `registerIpcHandlers` further down never ran, and the window came up with
 * every channel missing. What the user saw was "No handler registered for
 * 'library:sync'" — three layers downstream of the real cause, and naming the
 * wrong subsystem entirely.
 *
 * So corruption is handled here instead. The damaged file is renamed aside —
 * never deleted, because its contents are usually still recoverable with
 * `sqlite3 .recover` even when the b-tree is past repair — and a fresh
 * database takes its place. `onRecovered` carries the new location out so the
 * interface can say what happened; without it the reset would be silent, and
 * a library that emptied itself with no explanation is its own kind of bug.
 *
 * Anything that is not corruption still throws. A permission error or a full
 * disk is a real problem the caller has to decide about, and quietly starting
 * over would destroy a perfectly good database on a transient fault.
 */
export function openDatabase(
  path: string,
  onRecovered?: (recovery: DatabaseRecovery) => void
): DatabaseSync {
  try {
    return prepare(path)
  } catch (error) {
    // ':memory:' is new on every open, so there is nothing to set aside and
    // nothing that a retry could do differently.
    if (path === ':memory:' || !isUnusableFile(error)) throw error

    // `prepare` has already closed its handle, so the file can be renamed.
    const movedTo = setAside(path, String(Date.now()))
    const db = prepare(path)
    onRecovered?.({ movedTo })
    return db
  }
}
