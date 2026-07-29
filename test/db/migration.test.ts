import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { MetadataRepository } from '@main/db/metadata'

/**
 * Migrations can only be checked against a file, not against
 * ':memory:' — an in-memory database is new on every open and never
 * carries an old schema.
 */
let directory: string
let dbPath: string

// In WAL mode SQLite keeps -wal and -shm open. If they stay open,
// afterEach cannot delete the directory on Windows (EBUSY). So every
// opened connection is tracked and closed at the end.
const openConnections: DatabaseSync[] = []

function openTracked(p: string): DatabaseSync {
  const db = openDatabase(p)
  openConnections.push(db)
  return db
}

/** Creates a database in the state BEFORE the launch_id column. */
function oldDatabase(p: string): void {
  const db = new DatabaseSync(p)
  db.exec(`
    CREATE TABLE games (
      id               TEXT PRIMARY KEY NOT NULL,
      store_id         TEXT NOT NULL,
      store_game_id    TEXT NOT NULL,
      name             TEXT NOT NULL,
      installed        INTEGER NOT NULL DEFAULT 0,
      install_path     TEXT,
      install_size     INTEGER,
      playtime_minutes INTEGER,
      last_played      INTEGER,
      favorite         INTEGER NOT NULL DEFAULT 0,
      hidden           INTEGER NOT NULL DEFAULT 0,
      first_seen       INTEGER NOT NULL,
      last_seen        INTEGER NOT NULL
    );
  `)
  db.prepare(
    `INSERT INTO games (id, store_id, store_game_id, name, installed, favorite, hidden, first_seen, last_seen)
     VALUES ('steam:440', 'steam', '440', 'TF2', 1, 1, 0, 100, 100)`
  ).run()
  db.close()
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'arcadia-migration-'))
  dbPath = join(directory, 'arcadia.db')
})

afterEach(async () => {
  for (const db of openConnections.splice(0)) {
    try {
      db.close()
    } catch {
      /* schon geschlossen */
    }
  }
  await rm(directory, { recursive: true, force: true })
})

describe('Schema migration', () => {
  it('adds a missing column to an existing database', () => {
    // CREATE TABLE IF NOT EXISTS never alters an existing table. Without
    // a migration every scan failed with "table games has no column named
    // launch_id" — exactly what happened when the field was introduced.
    oldDatabase(dbPath)
    const db = openTracked(dbPath)
    const columns = (
      db.prepare("SELECT name FROM pragma_table_info('games')").all() as unknown as Array<{
        name: string
      }>
    ).map((r) => r.name)
    expect(columns).toContain('launch_id')
  })

  it('preserves the existing data while doing so', () => {
    // A migration that empties the library would be worse than the bug it
    // fixes.
    oldDatabase(dbPath)
    const repo = new GameRepository(openTracked(dbPath))
    const game = repo.byId('steam:440')
    expect(game?.name).toBe('TF2')
    expect(game?.favorite).toBe(true)
    expect(game?.launchId).toBeUndefined()
  })

  it('can be run repeatedly without failing', () => {
    // The app opens the database afresh on every start.
    oldDatabase(dbPath)
    openTracked(dbPath).close()
    expect(() => openTracked(dbPath).close()).not.toThrow()
  })

  it('creates a fresh database with every column straight away', () => {
    const db = openTracked(dbPath)
    const columns = (
      db.prepare("SELECT name FROM pragma_table_info('games')").all() as unknown as Array<{
        name: string
      }>
    ).map((r) => r.name)
    expect(columns).toContain('launch_id')
    expect(columns).toContain('playtime_minutes')
  })

  it('adds artwork_attempts to a metadata table from plan 3', () => {
    // The table already existed, the column did not. CREATE TABLE IF NOT
    // EXISTS would never have added it, and every artwork pass would have
    // failed with "no such column: artwork_attempts" — the same trap as
    // with launch_id, where the app then showed zero games.
    const old = new DatabaseSync(dbPath)
    old.exec(`
      CREATE TABLE games (
        id TEXT PRIMARY KEY NOT NULL, store_id TEXT NOT NULL,
        store_game_id TEXT NOT NULL, name TEXT NOT NULL,
        installed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE metadata (
        game_id TEXT PRIMARY KEY NOT NULL, steam_appid INTEGER,
        match_source TEXT, fetch_attempts INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO games (id, store_id, store_game_id, name, first_seen, last_seen)
        VALUES ('steam:440', 'steam', '440', 'TF2', 100, 100);
      INSERT INTO metadata (game_id, steam_appid) VALUES ('steam:440', 440);
    `)
    old.close()

    const db = openTracked(dbPath)
    const columns = (
      db.prepare("SELECT name FROM pragma_table_info('metadata')").all() as unknown as Array<{
        name: string
      }>
    ).map((r) => r.name)
    expect(columns).toContain('artwork_attempts')

    // The existing row is still there, with a usable default.
    const row = db
      .prepare("SELECT steam_appid, artwork_attempts FROM metadata WHERE game_id = 'steam:440'")
      .get() as unknown as { steam_appid: number; artwork_attempts: number }
    expect(row.steam_appid).toBe(440)
    expect(row.artwork_attempts).toBe(0)
  })

  it('finds the artwork gap in a migrated database', () => {
    // The counter-check on behaviour: after the migration the query has to
    // run, not merely the column exist.
    oldDatabase(dbPath)
    const db = openTracked(dbPath)
    expect(new MetadataRepository(db).gameIdsWithoutArtwork(10)).toEqual(['steam:440'])
  })

  it('adds the metadata tables to a database from plan 2', () => {
    // Plan 2 did not know metadata and artwork yet. An existing database
    // has to get them without losing games — which is exactly where
    // everything once ground to a halt with the launch_id field.
    oldDatabase(dbPath)
    const db = openTracked(dbPath)

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as unknown as Array<{ name: string }>
    ).map((r) => r.name)
    expect(tables).toContain('metadata')
    expect(tables).toContain('artwork')

    // And the library is still standing.
    const count = db.prepare('SELECT COUNT(*) c FROM games').get() as unknown as { c: number }
    expect(count.c).toBe(1)
  })

  it('can write after the migration too', () => {
    // The actual bug only showed on writing, not on opening — hence a real
    // scan here.
    oldDatabase(dbPath)
    const repo = new GameRepository(openTracked(dbPath))
    expect(() =>
      repo.upsertScan(
        'epic',
        [{ storeGameId: 'k', name: 'Foretales', installed: true, launchId: 'app' }],
        200
      )
    ).not.toThrow()
    expect(repo.byId('epic:k')?.launchId).toBe('app')
  })
})
