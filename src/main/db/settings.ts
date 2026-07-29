import type { DatabaseSync } from 'node:sqlite'

/**
 * Key/value access to the `settings` table.
 *
 * The table has existed since plan 1 but had no accessor at all — nothing
 * read or wrote it. The language switch is the first preference that has to
 * outlive a restart, so this is where that starts.
 */
export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as
      | { value: string }
      | undefined
    return row?.value
  }

  set(key: string, value: string): void {
    // ON CONFLICT rather than DELETE+INSERT: the key is the primary key, and
    // a second row for the same setting would make `get` depend on row order.
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }
}
