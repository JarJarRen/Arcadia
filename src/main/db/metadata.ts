import type { DatabaseSync } from 'node:sqlite'
import type { Language } from '@shared/i18n'
import {
  STEAM_ASSET_BASE,
  type ArtworkKind,
  type ArtworkRef,
  type GameMetadata,
  type MatchSource
} from '@shared/metadata'

/** After this many failed attempts a game is no longer queried. */
const MAX_ATTEMPTS = 3

interface MetadataRow {
  game_id: string
  steam_appid: number | null
  match_source: string | null
  short_description: string | null
  description: string | null
  developers: string | null
  publishers: string | null
  genres: string | null
  release_date: string | null
  metacritic: number | null
  screenshots: string | null
  fetched_at: number | null
  fetch_failed_at: number | null
  fetch_attempts: number
}

/**
 * The joined columns from `metadata_text`.
 *
 * Aliased rather than selected under their own names: `metadata` still
 * carries columns of the same name from before the split, and an unaliased
 * `SELECT m.*, x.*` would let SQLite pick either one silently.
 */
interface LocalisedColumns {
  text_short: string | null
  text_long: string | null
  text_genres: string | null
  text_release: string | null
}

/** List from JSON text, tolerant of anything unexpected. */
function toList(value: string | null): string[] {
  if (value === null || value === '') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function toMetadata(row: MetadataRow & Partial<LocalisedColumns>): GameMetadata {
  return {
    steamAppId: row.steam_appid ?? undefined,
    matchSource: (row.match_source as MatchSource | null) ?? undefined,
    shortDescription: row.text_short ?? undefined,
    description: row.text_long ?? undefined,
    developers: toList(row.developers),
    publishers: toList(row.publishers),
    genres: toList(row.text_genres ?? null),
    releaseDate: row.text_release ?? undefined,
    metacritic: row.metacritic ?? undefined,
    screenshots: toList(row.screenshots),
    fetchedAt: row.fetched_at ?? undefined,
    fetchFailedAt: row.fetch_failed_at ?? undefined,
    fetchAttempts: row.fetch_attempts
  }
}

export class MetadataRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Metadata for one language.
   *
   * The language-independent part comes from `metadata`, the text from
   * `metadata_text` for the requested language. A game can have the former
   * and not the latter — that is the normal state right after a language
   * switch, and it renders as a details page without a description rather
   * than as an error.
   */
  get(gameId: string, language: Language): GameMetadata | undefined {
    const row = this.db
      .prepare(
        `SELECT m.*,
                x.short_description AS text_short,
                x.description       AS text_long,
                x.genres            AS text_genres,
                x.release_date      AS text_release
         FROM metadata m
         LEFT JOIN metadata_text x
           ON x.game_id = m.game_id AND x.language = @language
         WHERE m.game_id = @gameId`
      )
      .get({ gameId, language }) as unknown as (MetadataRow & LocalisedColumns) | undefined
    return row ? toMetadata(row) : undefined
  }

  /**
   * Writes fetched metadata.
   *
   * **A manual match is never overwritten by this.** The AppID and the
   * source stay put once `match_source = 'manual'` is set — otherwise every
   * correction the user made would be gone on the next fetch, and nobody
   * would notice, because the result looks plausible.
   *
   * The remaining fields are filled regardless: what is protected is the
   * match, not the content. A manually matched game is supposed to get a
   * description.
   */
  upsert(gameId: string, meta: Partial<GameMetadata>, language: Language): void {
    this.db
      .prepare(
        `INSERT INTO metadata (
           game_id, steam_appid, match_source,
           developers, publishers, metacritic,
           screenshots, fetched_at, fetch_attempts
         ) VALUES (
           @gameId, @appId, @source,
           @dev, @pub, @metacritic,
           @shots, @fetched, 0
         )
         ON CONFLICT(game_id) DO UPDATE SET
           steam_appid  = CASE WHEN metadata.match_source = 'manual'
                               THEN metadata.steam_appid ELSE excluded.steam_appid END,
           match_source = CASE WHEN metadata.match_source = 'manual'
                               THEN 'manual' ELSE excluded.match_source END,
           developers        = COALESCE(excluded.developers, metadata.developers),
           publishers        = COALESCE(excluded.publishers, metadata.publishers),
           metacritic        = COALESCE(excluded.metacritic, metadata.metacritic),
           screenshots       = COALESCE(excluded.screenshots, metadata.screenshots),
           fetched_at        = COALESCE(excluded.fetched_at, metadata.fetched_at),
           fetch_attempts    = 0`
      )
      .run({
        gameId,
        appId: meta.steamAppId ?? null,
        source: meta.matchSource ?? null,
        dev: meta.developers ? JSON.stringify(meta.developers) : null,
        pub: meta.publishers ? JSON.stringify(meta.publishers) : null,
        metacritic: meta.metacritic ?? null,
        shots: meta.screenshots ? JSON.stringify(meta.screenshots) : null,
        fetched: meta.fetchedAt ?? null
      })

    // Keyed by (game_id, language), so writing one language leaves the other
    // untouched — the whole point of the second table.
    this.db
      .prepare(
        `INSERT INTO metadata_text (
           game_id, language, short_description, description, genres, release_date, fetched_at
         ) VALUES (@gameId, @language, @short, @long, @genres, @release, @fetched)
         ON CONFLICT(game_id, language) DO UPDATE SET
           short_description = COALESCE(excluded.short_description, metadata_text.short_description),
           description       = COALESCE(excluded.description, metadata_text.description),
           genres            = COALESCE(excluded.genres, metadata_text.genres),
           release_date      = COALESCE(excluded.release_date, metadata_text.release_date),
           fetched_at        = COALESCE(excluded.fetched_at, metadata_text.fetched_at)`
      )
      .run({
        gameId,
        language,
        short: meta.shortDescription ?? null,
        long: meta.description ?? null,
        genres: meta.genres ? JSON.stringify(meta.genres) : null,
        release: meta.releaseDate ?? null,
        fetched: meta.fetchedAt ?? null
      })
  }

  /** Sets the match by hand; beats every automatic source. */
  setManualMatch(gameId: string, steamAppId: number): void {
    this.db
      .prepare(
        `INSERT INTO metadata (game_id, steam_appid, match_source, fetch_attempts)
         VALUES (@gameId, @appId, 'manual', 0)
         ON CONFLICT(game_id) DO UPDATE SET
           steam_appid    = excluded.steam_appid,
           match_source   = 'manual',
           fetch_attempts = 0,
           -- Discard the content: it belongs to the previous, wrong game.
           -- Completely, including developers and publishers: the later
           -- fetch fills only empty fields via COALESCE, so a developer
           -- left standing here would stay the wrong game's forever.
           developers        = NULL,
           publishers        = NULL,
           metacritic        = NULL,
           screenshots       = NULL,
           fetched_at        = NULL,
           fetch_failed_at   = NULL`
      )
      .run({ gameId, appId: steamAppId })

    // Every language, not just the current one. The text belongs to the
    // wrong game; leaving another language behind would keep the wrong
    // description one language switch away — the exact defect a manual
    // match exists to repair.
    this.db.prepare('DELETE FROM metadata_text WHERE game_id = ?').run(gameId)
  }

  /**
   * Games still awaiting a metadata fetch **for this language**.
   *
   * Two separate reasons to be pending, and both matter:
   *
   *  - no metadata at all — never fetched, or fetched and failed;
   *  - metadata present but no text in this language — the normal state
   *    right after the user switches language.
   *
   * The second is what makes a language switch self-healing: the existing
   * queue picks the games up on its next pass and fills them in at the
   * existing rate limit. No separate refetch mechanism.
   *
   * `fetch_attempts` still guards both, so a game Steam does not know is not
   * retried forever merely because a language is missing.
   */
  pendingGameIds(limit: number, language: Language): string[] {
    const rows = this.db
      .prepare(
        `SELECT g.id FROM games g
         LEFT JOIN metadata m ON m.game_id = g.id
         LEFT JOIN metadata_text x ON x.game_id = g.id AND x.language = @language
         WHERE g.hidden = 0
           AND (
             m.game_id IS NULL
             OR (m.fetched_at IS NULL AND m.fetch_attempts < @max)
             OR (x.game_id IS NULL AND m.fetch_attempts < @max)
           )
         ORDER BY g.installed DESC, g.name COLLATE NOCASE
         LIMIT @limit`
      )
      .all({ max: MAX_ATTEMPTS, limit, language }) as unknown as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  /**
   * Games without any image where an attempt is still open.
   *
   * Separate from `pendingGameIds`: that one works through games *without
   * metadata*. The gaps here usually have some — only the image is missing,
   * because the store fetch failed or because Steam's `library_600x900`
   * does not exist for that AppID.
   *
   * Installed games first: those are the ones most likely to be looked at.
   */
  gameIdsWithoutArtwork(limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT g.id FROM games g
         LEFT JOIN metadata m ON m.game_id = g.id
         WHERE g.hidden = 0
           -- Specifically the grid, not "any artwork at all". The tile
           -- shows the grid, so a game with only a header has no picture
           -- where it counts. Measured: 13 games here have a header but no
           -- library_600x900, and the old condition excluded every one of
           -- them from the fallback that exists to fix exactly this.
           AND NOT EXISTS (
             SELECT 1 FROM artwork a WHERE a.game_id = g.id AND a.kind = 'grid'
           )
           AND COALESCE(m.artwork_attempts, 0) < @max
         ORDER BY g.installed DESC, g.name COLLATE NOCASE
         LIMIT @limit`
      )
      .all({ max: MAX_ATTEMPTS, limit }) as unknown as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  /**
   * Forgets one piece of artwork that turned out not to exist.
   *
   * Steam's URLs are built from the AppID and were stored unverified, so a
   * game without a library capsule got a row pointing at a 404. The row's
   * presence then counted as proof of artwork and kept the game out of the
   * SteamGridDB fallback for good.
   *
   * The attempt counter is deliberately left alone. If the fallback then
   * supplies a URL that is itself broken, the renderer reports that one
   * too — and without a rising counter the pair would trade the same row
   * back and forth for ever.
   */
  removeArtwork(gameId: string, kind: ArtworkKind): void {
    this.db.prepare('DELETE FROM artwork WHERE game_id = ? AND kind = ?').run(gameId, kind)
  }

  markArtworkFailed(gameId: string): void {
    this.db
      .prepare(
        `INSERT INTO metadata (game_id, artwork_attempts) VALUES (@gameId, 1)
         ON CONFLICT(game_id) DO UPDATE SET
           artwork_attempts = metadata.artwork_attempts + 1`
      )
      .run({ gameId })
  }

  markFetchFailed(gameId: string, when: number): void {
    this.db
      .prepare(
        `INSERT INTO metadata (game_id, fetch_failed_at, fetch_attempts)
         VALUES (@gameId, @when, 1)
         ON CONFLICT(game_id) DO UPDATE SET
           fetch_failed_at = excluded.fetch_failed_at,
           fetch_attempts  = metadata.fetch_attempts + 1`
      )
      .run({ gameId, when })
  }

  artworkFor(gameId: string): ArtworkRef[] {
    const rows = this.db
      .prepare('SELECT kind, url FROM artwork WHERE game_id = ? ORDER BY kind')
      .all(gameId) as unknown as ArtworkRef[]
    return rows.map((row) => ({ kind: row.kind, url: row.url }))
  }

  /**
   * Removes only a game's Steam-derived images.
   *
   * Needed after a manual correction: Steam's image URLs are built from the
   * AppID, so after a correction they belong to the wrong game. The queue
   * only fills in *missing* image kinds — without this deletion the wrong
   * image would stay while the title and description were already the right
   * ones. Nobody would spot that as a bug.
   *
   * Epic's images deliberately stay: they come from the local catalogue and
   * are correct regardless of which Steam page is matched.
   */
  clearSteamArtwork(gameId: string): void {
    // Named parameters only: node:sqlite does not accept a mixture of named
    // and positional values in one call.
    this.db
      .prepare('DELETE FROM artwork WHERE game_id = @gameId AND url LIKE @prefix')
      .run({ gameId, prefix: `${STEAM_ASSET_BASE}%` })
  }

  upsertArtwork(gameId: string, refs: ArtworkRef[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO artwork (game_id, kind, url) VALUES (@gameId, @kind, @url)
       ON CONFLICT(game_id, kind) DO UPDATE SET url = excluded.url`
    )
    for (const ref of refs) stmt.run({ gameId, kind: ref.kind, url: ref.url })
  }
}
