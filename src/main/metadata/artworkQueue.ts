import type { ArtworkRef } from '@shared/metadata'
import type { GameRepository } from '@main/db/repository'
import type { MetadataRepository } from '@main/db/metadata'
import { getLanguage } from '@shared/i18n'

/** How many gaps a single pass tackles at most. */
const DEFAULT_BATCH = 25

export interface ArtworkDeps {
  /** SteamGridDB identifier for a Steam AppID. */
  lookupBySteamAppId: (appId: number) => Promise<number | undefined>
  /** Identifier via the name — only on an exact match. */
  searchExact: (name: string) => Promise<number | undefined>
  fetchArtwork: (sgdbId: number) => Promise<ArtworkRef[]>
  pause: (ms: number) => Promise<void>
  pauseMs: number
}

export interface ArtworkPassResult {
  considered: number
  found: number
  noMatch: number
}

/**
 * Closes artwork gaps via SteamGridDB.
 *
 * A pass of its own, not part of `runMetadataPass`: that one works through
 * games *without metadata*. The gaps here usually have metadata — only the
 * image is missing, because the store fetch failed or because Steam's
 * `library_600x900` does not exist for that AppID.
 *
 * Measured on the development machine: 17 gaps, 15 of them closable. The
 * remaining two are deliberately left open — see `searchExact`.
 */
export async function runArtworkPass(
  games: GameRepository,
  metadata: MetadataRepository,
  deps: ArtworkDeps,
  batchSize: number = DEFAULT_BATCH
): Promise<ArtworkPassResult> {
  const result: ArtworkPassResult = { considered: 0, found: 0, noMatch: 0 }

  for (const gameId of metadata.gameIdsWithoutArtwork(batchSize)) {
    const game = games.byId(gameId)
    if (game === undefined) continue
    result.considered++

    // For Steam the storeGameId is the AppID, and SteamGridDB keeps an
    // index on it. That is the reliable answer — all 14 Steam gaps checked
    // were found this way. Name matching here could only go wrong.
    let sgdbId: number | undefined
    if (game.storeId === 'steam') {
      const appId = Number.parseInt(game.storeGameId, 10)
      if (Number.isFinite(appId)) sgdbId = await deps.lookupBySteamAppId(appId)
    } else {
      // For non-Steam games try the AppID first as well, in case the
      // metadata already knows one — it is more precise than any name.
      const existing = metadata.get(gameId, getLanguage())
      if (existing?.steamAppId !== undefined) {
        sgdbId = await deps.lookupBySteamAppId(existing.steamAppId)
      }
      if (sgdbId === undefined) sgdbId = await deps.searchExact(game.name)
    }

    if (sgdbId === undefined) {
      metadata.markArtworkFailed(gameId)
      result.noMatch++
      await deps.pause(deps.pauseMs)
      continue
    }

    const images = await deps.fetchArtwork(sgdbId)
    if (images.length === 0) {
      metadata.markArtworkFailed(gameId)
      result.noMatch++
    } else {
      metadata.upsertArtwork(gameId, images)
      result.found++
    }

    await deps.pause(deps.pauseMs)
  }

  return result
}
