import type { DatabaseSync } from 'node:sqlite'
import type {
  ClaimState,
  Freebie,
  FreebieKind,
  FreebieSource,
  RawFreebie
} from '@shared/freebies'
import type { StoreId } from '@shared/types'
import { freebieId } from '@main/freebies/merge'

interface FreebieRow {
  id: string
  store_id: string
  title: string
  kind: string
  store_game_id: string | null
  claim_url: string | null
  image_url: string | null
  starts_at: number | null
  ends_at: number | null
  source: string
  opened_at: number | null
  confirmed_at: number | null
}

function claimState(row: FreebieRow): ClaimState {
  if (row.confirmed_at !== null) return 'confirmed'
  if (row.opened_at !== null) return 'pending'
  return 'unclaimed'
}

function toFreebie(row: FreebieRow): Freebie {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    title: row.title,
    kind: row.kind as FreebieKind,
    ...(row.store_game_id === null ? {} : { storeGameId: row.store_game_id }),
    ...(row.claim_url === null ? {} : { claimUrl: row.claim_url }),
    ...(row.image_url === null ? {} : { imageUrl: row.image_url }),
    ...(row.starts_at === null ? {} : { startsAt: row.starts_at }),
    ...(row.ends_at === null ? {} : { endsAt: row.ends_at }),
    source: row.source as FreebieSource,
    claim: claimState(row)
  }
}

/**
 * Every read joins the claim table, so a caller can never see a row
 * without knowing whether it has been claimed. LEFT JOIN, because most
 * rows have no claim and an inner join would hide them.
 */
const SELECT = `
  SELECT f.*, c.opened_at, c.confirmed_at
  FROM freebies f
  LEFT JOIN freebie_claims c ON c.freebie_id = f.id
`

export class FreebieRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Replaces the cache in one transaction.
   *
   * Wholesale rather than a diff: the list is at most a few dozen rows, and
   * a delete-then-insert cannot leave a promotion behind that the sources
   * have stopped reporting.
   */
  replaceAll(rows: RawFreebie[], now: number): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO freebies
        (id, store_id, title, kind, store_game_id, claim_url, image_url,
         starts_at, ends_at, source, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM freebies')
      for (const row of rows) {
        insert.run(
          freebieId(row.storeId, row.title),
          row.storeId,
          row.title,
          row.kind,
          row.storeGameId ?? null,
          row.claimUrl ?? null,
          row.imageUrl ?? null,
          row.startsAt ?? null,
          row.endsAt ?? null,
          row.source,
          now
        )
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
  }

  list(): Freebie[] {
    return (this.db.prepare(SELECT).all() as unknown as FreebieRow[]).map(toFreebie)
  }

  find(id: string): Freebie | undefined {
    const row = this.db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as unknown as
      | FreebieRow
      | undefined
    return row === undefined ? undefined : toFreebie(row)
  }

  markOpened(id: string, now: number): void {
    // ON CONFLICT exists for re-opening a still-pending claim, e.g. the
    // first click did not actually complete the claim on the store's site.
    // A confirmed row is never reachable here: the UI renders it as static
    // "✓ In your library" text with no button, so there is no path back
    // into this query once confirmed_at is set, and none is needed.
    this.db
      .prepare(
        `INSERT INTO freebie_claims (freebie_id, opened_at, confirmed_at)
         VALUES (?, ?, NULL)
         ON CONFLICT(freebie_id) DO UPDATE SET opened_at = excluded.opened_at`
      )
      .run(id, now)
  }

  markConfirmed(id: string, now: number): void {
    this.db
      .prepare('UPDATE freebie_claims SET confirmed_at = ? WHERE freebie_id = ?')
      .run(now, id)
  }

  /** The claims a library scan still has to look for. */
  pendingClaims(): Array<{
    id: string
    storeId: StoreId
    title: string
    storeGameId?: string
  }> {
    const rows = this.db
      .prepare(
        `SELECT f.id, f.store_id, f.title, f.store_game_id
         FROM freebie_claims c
         JOIN freebies f ON f.id = c.freebie_id
         WHERE c.confirmed_at IS NULL`
      )
      .all() as unknown as Array<{
      id: string
      store_id: string
      title: string
      store_game_id: string | null
    }>

    return rows.map((row) => ({
      id: row.id,
      storeId: row.store_id as StoreId,
      title: row.title,
      ...(row.store_game_id === null ? {} : { storeGameId: row.store_game_id })
    }))
  }

  pruneClaims(before: number): void {
    this.db.prepare('DELETE FROM freebie_claims WHERE opened_at < ?').run(before)
  }
}
