import { STEAM_ASSET_BASE, type ArtworkRef, type GameMetadata, type MatchSource } from '@shared/metadata'
import { getLanguage } from '@shared/i18n'
import type { GameRepository } from '@main/db/repository'
import type { MetadataRepository } from '@main/db/metadata'
import { SteamStoreError } from './steamStore'

/**
 * Gap between two store fetches.
 *
 * The store API rate-limits noticeably. Without a pause the first pass over
 * 193 games would run into a block — and a block costs more time than
 * slowing down does.
 */
const PAUSE_MS = 1500

/** How many games a single pass fetches at most. */
const DEFAULT_BATCH = 40

export interface MetadataDeps {
  /** Steam AppID for a name, from the app list. */
  findAppId: (name: string) => number | undefined
  fetchDetails: (appId: number) => Promise<GameMetadata | undefined>
  /** Artwork per Epic catalogue ID, from the local cache. */
  epicArtwork: Map<string, ArtworkRef[]>
  pause: (ms: number) => Promise<void>
  now: () => number
  /**
   * Does this image really exist?
   *
   * Steam's URLs are derived from the AppID, not reported by the API, so
   * they are a guess. For most games it is right; for games without a
   * library capsule — older titles, small ones — `library_600x900.jpg`
   * is a 404. Measured on a real library: 13 of 217 Steam games.
   *
   * Stored unchecked, such a row counted as artwork and kept the game out
   * of the SteamGridDB fallback for good, which is the one mechanism meant
   * to fill precisely that gap.
   */
  imageExists?: (url: string) => Promise<boolean>
}

export interface MetadataPassResult {
  considered: number
  succeeded: number
  failed: number
  rateLimited: boolean
}

/**
 * Steam's image URLs follow a fixed scheme and need no fetch of their own.
 * `library_600x900` is the portrait format for the tile, `header` the wide
 * format for the details page.
 */
function steamArtwork(appId: number): ArtworkRef[] {
  const base = `${STEAM_ASSET_BASE}/${appId}`
  return [
    { kind: 'grid', url: `${base}/library_600x900.jpg` },
    { kind: 'hero', url: `${base}/header.jpg` }
  ]
}

/**
 * Confirms an image is really there before it is written down.
 *
 * A HEAD request, so nothing is downloaded — the point is only whether
 * Valve has the asset. Anything other than a clear yes counts as no: an
 * unverified row is what caused the bug this guards against, and a game
 * without a row simply goes to the SteamGridDB fallback instead.
 */
const defaultImageExists = async (url: string): Promise<boolean> => {
  const response = await fetch(url, { method: 'HEAD' })
  return response.ok
}

/** The subset of the derived URLs that Valve actually serves. */
async function verifiedSteamArtwork(
  appId: number,
  present: ReadonlySet<string>,
  exists: (url: string) => Promise<boolean>
): Promise<ArtworkRef[]> {
  const candidates = steamArtwork(appId).filter((image) => !present.has(image.kind))
  const checked = await Promise.all(
    candidates.map(async (image) => {
      try {
        return (await exists(image.url)) ? image : undefined
      } catch {
        // Offline, or Valve unreachable. Storing it anyway would be a
        // guess, and guessing is the defect.
        return undefined
      }
    })
  )
  return checked.filter((image): image is ArtworkRef => image !== undefined)
}

/**
 * Records a hand-picked match and fetches it straight away.
 *
 * Straight away rather than on the next pass, because the correction is a
 * deliberate act: whoever triggers it is looking at the page and expects
 * something to change. One batch later would be technically the same and
 * would feel like a failure.
 *
 * Returns whether the fetch succeeded. The match itself stands even when it
 * does not — it is the user's decision, not the result of a fetch, and a
 * later pass will collect the content.
 */
export async function applyManualMatch(
  metadata: MetadataRepository,
  gameId: string,
  appId: number,
  deps: Pick<MetadataDeps, 'fetchDetails' | 'now' | 'imageExists'>
): Promise<boolean> {
  metadata.setManualMatch(gameId, appId)
  // Steam's images are derived from the AppID and therefore belong to the
  // previous game. The queue only fills in missing kinds and would leave
  // them in place.
  metadata.clearSteamArtwork(gameId)

  try {
    const data = await deps.fetchDetails(appId)
    if (data === undefined) {
      metadata.markFetchFailed(gameId, deps.now())
      return false
    }
    metadata.upsert(
      gameId,
      { ...data, steamAppId: appId, matchSource: 'manual', fetchedAt: deps.now() },
      getLanguage()
    )
    const present = new Set(metadata.artworkFor(gameId).map((image) => image.kind))
    const missing = await verifiedSteamArtwork(
      appId,
      present,
      deps.imageExists ?? defaultImageExists
    )
    if (missing.length > 0) metadata.upsertArtwork(gameId, missing)
    return true
  } catch {
    metadata.markFetchFailed(gameId, deps.now())
    return false
  }
}

/**
 * One pass of metadata collection.
 *
 * Deliberately bounded rather than exhaustive: the first run over 193 games
 * took roughly five minutes at 1.5 seconds apart. In batches the app stays
 * usable, and every restart picks up where it left off.
 */
export async function runMetadataPass(
  games: GameRepository,
  metadata: MetadataRepository,
  deps: MetadataDeps,
  batchSize: number = DEFAULT_BATCH
): Promise<MetadataPassResult> {
  const result: MetadataPassResult = {
    considered: 0,
    succeeded: 0,
    failed: 0,
    rateLimited: false
  }

  // Captured once for the whole pass. Reading it per game would let a
  // language switch mid-pass write half the batch into one language and half
  // into the other.
  const language = getLanguage()

  for (const gameId of metadata.pendingGameIds(batchSize, language)) {
    const game = games.byId(gameId)
    if (game === undefined) continue
    result.considered++

    // Epic artwork comes from the local catalogue — no network, regardless
    // of whether the store fetch succeeds.
    if (game.storeId === 'epic') {
      const images = deps.epicArtwork.get(game.storeGameId)
      if (images !== undefined) metadata.upsertArtwork(gameId, images)
    }

    // For Steam the storeGameId IS the AppID. Name matching would not just
    // be redundant, it could go wrong.
    let appId: number | undefined
    let source: MatchSource
    if (game.storeId === 'steam') {
      const parsed = Number.parseInt(game.storeGameId, 10)
      appId = Number.isFinite(parsed) ? parsed : undefined
      source = 'steam-appid'
    } else {
      // A manual match beats every automatic source.
      const existing = metadata.get(gameId, language)
      if (existing?.matchSource === 'manual' && existing.steamAppId !== undefined) {
        appId = existing.steamAppId
        source = 'manual'
      } else {
        appId = deps.findAppId(game.name)
        source = 'name-exact'
      }
    }

    if (appId === undefined) {
      // Steam does not know the game. Record it as a failed attempt,
      // otherwise it would come up again on every pass.
      metadata.markFetchFailed(gameId, deps.now())
      result.failed++
      continue
    }

    try {
      const data = await deps.fetchDetails(appId)
      if (data === undefined) {
        metadata.markFetchFailed(gameId, deps.now())
        result.failed++
      } else {
        metadata.upsert(
          gameId,
          { ...data, steamAppId: appId, matchSource: source, fetchedAt: deps.now() },
          language
        )

        // Steam's artwork is the fallback, not the first choice. An Epic
        // game already has Epic's own image — that matches the edition
        // bought there better and is reliably present, while Steam's
        // library_600x900 does not exist for every AppID.
        const present = new Set(metadata.artworkFor(gameId).map((image) => image.kind))
        const missing = await verifiedSteamArtwork(
          appId,
          present,
          deps.imageExists ?? defaultImageExists
        )
        if (missing.length > 0) metadata.upsertArtwork(gameId, missing)

        result.succeeded++
      }
    } catch (error) {
      if (error instanceof SteamStoreError && error.kind === 'rate-limited') {
        // After a block only waiting helps. Further fetches merely extend
        // it — the rest comes up on the next pass. The game is not charged
        // a failed attempt: it is not at fault.
        result.rateLimited = true
        return result
      }
      metadata.markFetchFailed(gameId, deps.now())
      result.failed++
    }

    await deps.pause(PAUSE_MS)
  }

  return result
}
