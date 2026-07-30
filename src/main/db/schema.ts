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
  -- Playable, but not licensed to this account. See shared/types.ts.
  shared_or_free   INTEGER NOT NULL DEFAULT 0,
  -- Added by hand for a game no adapter can see: EA reports only what has
  -- been installed on this machine, so the rest of a library stays
  -- invisible without this.
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
  { table: 'games', column: 'manual', definition: 'INTEGER NOT NULL DEFAULT 0' }
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

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  // node:sqlite has no db.pragma() — PRAGMAs go through exec().
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  backfillMetadataText(db)
  runOnce(db, 'repair:hero-gaps', repairHeroGaps)
  return db
}
