import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '@main/db/schema'

const opened: DatabaseSync[] = []
const dirs: string[] = []

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arcadia-backfill-'))
  dirs.push(dir)
  return join(dir, 'arcadia.db')
}

function open(path: string): DatabaseSync {
  const db = openDatabase(path)
  opened.push(db)
  return db
}

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close()
    } catch {
      // already closed
    }
  }
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows keeps the WAL sidecar locked for a moment; the temp
      // directory is disposable either way.
    }
  }
})

/** A plan-4 database: metadata with text in its own columns, no metadata_text. */
function plan4Database(path: string): void {
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE games (
      id TEXT PRIMARY KEY NOT NULL, store_id TEXT NOT NULL,
      store_game_id TEXT NOT NULL, name TEXT NOT NULL,
      installed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE metadata (
      game_id TEXT PRIMARY KEY NOT NULL, steam_appid INTEGER, match_source TEXT,
      short_description TEXT, description TEXT, developers TEXT, publishers TEXT,
      genres TEXT, release_date TEXT, metacritic INTEGER, screenshots TEXT,
      fetched_at INTEGER, fetch_failed_at INTEGER,
      fetch_attempts INTEGER NOT NULL DEFAULT 0, artwork_attempts INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO games (id, store_id, store_game_id, name, first_seen, last_seen)
      VALUES ('steam:1091500', 'steam', '1091500', 'Cyberpunk 2077', 100, 100);
    INSERT INTO metadata (
      game_id, steam_appid, short_description, description, genres, release_date,
      screenshots, fetched_at
    ) VALUES (
      'steam:1091500', 1091500, 'Kurz', 'Lang', '["Rollenspiel"]', '9. Dez. 2020',
      '["https://a/1.jpg"]', 1700000000
    );
  `)
  old.close()
}

describe('Backfill into metadata_text', () => {
  it('moves the existing text across, labelled German', () => {
    // The code that wrote those rows asked Steam for l=german without a
    // choice, so German is the right label for anything that predates the
    // language switch.
    const path = tempDb()
    plan4Database(path)
    const db = open(path)

    const row = db
      .prepare('SELECT language, short_description, description, genres, release_date FROM metadata_text WHERE game_id = ?')
      .get('steam:1091500') as unknown as
      | { language: string; short_description: string; description: string; genres: string; release_date: string }
      | undefined

    expect(row?.language).toBe('de')
    expect(row?.short_description).toBe('Kurz')
    expect(row?.description).toBe('Lang')
    expect(row?.genres).toBe('["Rollenspiel"]')
    expect(row?.release_date).toBe('9. Dez. 2020')
  })

  it('leaves the language-independent columns where they are', () => {
    const path = tempDb()
    plan4Database(path)
    const db = open(path)

    const row = db
      .prepare('SELECT steam_appid, screenshots FROM metadata WHERE game_id = ?')
      .get('steam:1091500') as unknown as { steam_appid: number; screenshots: string }

    expect(row.steam_appid).toBe(1091500)
    expect(row.screenshots).toBe('["https://a/1.jpg"]')
  })

  it('does not run a second time', () => {
    // A second pass would overwrite text that has since been fetched
    // properly — the German backfill would clobber a real English row.
    const path = tempDb()
    plan4Database(path)
    const first = open(path)
    first.exec("UPDATE metadata_text SET description = 'von Hand korrigiert'")
    first.close()

    const second = open(path)
    const row = second
      .prepare('SELECT description FROM metadata_text WHERE game_id = ?')
      .get('steam:1091500') as unknown as { description: string }

    expect(row.description).toBe('von Hand korrigiert')
  })

  it('skips games that never had any text', () => {
    const path = tempDb()
    plan4Database(path)
    const setup = new DatabaseSync(path)
    setup.exec(`
      INSERT INTO games (id, store_id, store_game_id, name, first_seen, last_seen)
        VALUES ('steam:440', 'steam', '440', 'TF2', 100, 100);
      INSERT INTO metadata (game_id, steam_appid) VALUES ('steam:440', 440);
    `)
    setup.close()

    const db = open(path)
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM metadata_text WHERE game_id = ?')
      .get('steam:440') as unknown as { n: number }

    expect(row.n).toBe(0)
  })
})
