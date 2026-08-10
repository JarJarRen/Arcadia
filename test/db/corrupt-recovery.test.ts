/**
 * What happens when `arcadia.db` is damaged.
 *
 * This is written from a real failure. A corrupt database threw inside
 * `openDatabase`, which sits partway through `app.whenReady()` — so
 * `registerIpcHandlers` further down never ran, and Arcadia came up with a
 * window, a rendered library view, and every single IPC channel missing. The
 * message on screen was "No handler registered for 'library:sync'", which
 * names the wrong subsystem and gives no hint that a file on disk is the
 * problem.
 *
 * The fixture below is a genuinely unusable file rather than a mock: a valid
 * SQLite header followed by garbage pages, which is what SQLite itself
 * reports as `errcode` 11. Nothing here asserts on the wording of SQLite's
 * message, because that is English prose it is free to reword.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type DatabaseRecovery } from '@main/db/schema'

// WAL mode keeps -wal and -shm open, and Windows refuses to delete a
// directory holding an open file. Every connection is tracked and closed.
const opened: DatabaseSync[] = []
const directories: string[] = []

function track(db: DatabaseSync): DatabaseSync {
  opened.push(db)
  return db
}

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'arcadia-corrupt-'))
  directories.push(directory)
  return directory
}

/**
 * A file SQLite will open and then fail to read.
 *
 * The header has to be genuine — a file of pure noise is rejected as "not a
 * database" (errcode 26) at a different point than a database whose pages are
 * damaged (errcode 11). Both must be survivable, so this fixture reproduces
 * the harder one: a real header, then rubbish where the schema should be.
 */
function corruptDatabase(path: string): void {
  const header = Buffer.alloc(100)
  header.write('SQLite format 3\0', 0, 'latin1')
  // Page size 4096, write/read version 1, and a page count that promises far
  // more than the file delivers.
  header.writeUInt16BE(4096, 16)
  header.writeUInt8(1, 18)
  header.writeUInt8(1, 19)
  header.writeUInt32BE(64, 28)

  const rubbish = Buffer.alloc(4096 * 3, 0xa5)
  writeFileSync(path, Buffer.concat([header, rubbish]))
}

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close()
    } catch {
      // Already closed by the code under test.
    }
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('openDatabase on a damaged file', () => {
  it('comes back with a working database instead of throwing', () => {
    const path = join(workspace(), 'arcadia.db')
    corruptDatabase(path)

    const db = track(openDatabase(path))

    // The whole point: the caller gets something it can use, so everything
    // downstream of it in startup still runs.
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('language', 'de')
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('language')).toEqual({
      value: 'de'
    })
  })

  it('keeps the damaged file instead of deleting it', () => {
    // Its contents are usually still recoverable with `sqlite3 .recover`
    // even when the b-tree is past repair, so deleting it would throw away
    // the user's favourites and manual entries for good.
    const path = join(workspace(), 'arcadia.db')
    corruptDatabase(path)
    const before = readFileSync(path)

    let recovery: DatabaseRecovery | undefined
    track(openDatabase(path, (r) => (recovery = r)))

    expect(recovery).toBeDefined()
    expect(existsSync(recovery!.movedTo)).toBe(true)
    expect(readFileSync(recovery!.movedTo)).toEqual(before)
  })

  it('reports where it put the file, so the interface can say so', () => {
    const path = join(workspace(), 'arcadia.db')
    corruptDatabase(path)

    let recovery: DatabaseRecovery | undefined
    track(openDatabase(path, (r) => (recovery = r)))

    // A library that emptied itself with no explanation is its own kind of
    // bug, so the new location has to reach the caller.
    expect(recovery?.movedTo.startsWith(path)).toBe(true)
    expect(recovery?.movedTo).not.toBe(path)
  })

  it('leaves no stale write-ahead log beside the fresh database', () => {
    // Left in place, SQLite would replay the old -wal into the newly created
    // database and damage that one too — the failure would appear to have
    // survived the reset.
    //
    // This asserts the property rather than the mechanism. Closing the handle
    // is usually what clears the sidecars (SQLite removes them when the last
    // connection goes), and moving them aside is the fallback for when that
    // close cannot happen. Either outcome satisfies the database; only "the
    // old log is still sitting there" does not.
    const path = join(workspace(), 'arcadia.db')
    const staleLog = Buffer.alloc(64, 0xff)
    corruptDatabase(path)
    writeFileSync(`${path}-wal`, staleLog)
    writeFileSync(`${path}-shm`, staleLog)

    const db = track(openDatabase(path))

    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${path}${suffix}`
      if (existsSync(sidecar)) {
        expect(readFileSync(sidecar).equals(staleLog)).toBe(false)
      }
    }
    // And the fresh database genuinely works, rather than merely existing.
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('language', 'en')
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 })
  })

  it('survives a damaged file that arrives with a write-ahead log', () => {
    // Worth its own case: with a -wal present SQLite reports errcode 26
    // (SQLITE_NOTADB) rather than 11 (SQLITE_CORRUPT), so recognising only
    // the latter would have left this exact combination fatal.
    const path = join(workspace(), 'arcadia.db')
    corruptDatabase(path)
    writeFileSync(`${path}-wal`, Buffer.alloc(64, 0xff))

    let recovery: DatabaseRecovery | undefined
    const db = track(openDatabase(path, (r) => (recovery = r)))

    expect(recovery).toBeDefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 0 })
  })

  it('leaves a healthy database alone', () => {
    const path = join(workspace(), 'arcadia.db')
    const first = track(openDatabase(path))
    first.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('language', 'de')
    first.close()

    const onRecovered = vi.fn()
    const second = track(openDatabase(path, onRecovered))

    expect(onRecovered).not.toHaveBeenCalled()
    expect(second.prepare('SELECT value FROM settings WHERE key = ?').get('language')).toEqual({
      value: 'de'
    })
  })

  it('still throws for a failure that resetting would not mend', () => {
    // A directory where the database should be is not corruption. Starting
    // over would be the wrong answer, and doing it silently could destroy a
    // healthy database on a transient fault.
    const path = workspace()

    expect(() => openDatabase(join(path))).toThrow()
  })
})
