import { join } from 'node:path'
import type { GameRepository } from '@main/db/repository'
import type { MetadataRepository } from '@main/db/metadata'
import { SteamAppList } from './steamAppList'
import { fetchAppDetails } from './steamStore'
import { readEpicArtwork } from './epicArtwork'
import { runMetadataPass } from './queue'
import { runArtworkPass } from './artworkQueue'
import { fetchArtwork, lookupBySteamAppId, searchExact, SGDB_PAUSE_MS } from './steamGridDb'
import { epicCatalogFile } from '@main/stores/epic/paths'

/** How long to wait after a rate-limit block before carrying on. */
const RATE_LIMIT_PAUSE_MS = 60_000

/** Pause between two passes, so the app can breathe. */
const BATCH_PAUSE_MS = 2_000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface MetadataServiceOptions {
  userDataDir: string
  steamApiKey?: string
  /** Without it, games lacking a store image stay without one — not an error. */
  steamGridDbKey?: string
  /** Called after every pass so the interface can catch up. */
  onProgress?: () => void
  /**
   * The app list to fill.
   *
   * Handed in from outside so that manual matching uses the same one:
   * loading 176,000 entries and 7.6 MB a second time just to serve a search
   * box would be waste. When absent, the service creates its own and nobody
   * else sees it.
   */
  appList?: SteamAppList
}

/**
 * Fetches metadata in the background until nothing is left open.
 *
 * Runs deliberately in batches with pauses between them: the first pass
 * over 193 Steam games takes about five minutes at 1.5 seconds apart. The
 * interface stays usable meanwhile and fills in gradually.
 *
 * Every step is built so a failure drags nothing else down: without the app
 * list, non-Steam games simply get no match; without the Epic catalogue,
 * its artwork is missing; and the Steam games go through regardless.
 */
export async function runMetadataService(
  games: GameRepository,
  metadata: MetadataRepository,
  options: MetadataServiceOptions
): Promise<void> {
  const appList = options.appList ?? new SteamAppList()
  const cachePath = join(options.userDataDir, 'steam-apps.json')

  // A stale cache beats no cache.
  const fromCache = await appList.loadCache(cachePath)
  if (options.steamApiKey !== undefined && options.steamApiKey !== '') {
    try {
      if (!fromCache) {
        const count = await appList.refresh(cachePath, { apiKey: options.steamApiKey })
        console.log(`Steam app list loaded: ${count} entries`)
      }
    } catch (error) {
      console.warn('Steam app list could not be loaded:', error)
    }
  }
  if (appList.size === 0) {
    console.warn(
      'Without the Steam app list, non-Steam games get no match. ' +
        'Is the Steam Web API key missing?'
    )
  }

  const epicArtwork = await readEpicArtwork(epicCatalogFile())
  if (epicArtwork.size > 0) {
    console.log(`Epic artwork from the catalogue: ${epicArtwork.size} games`)
  }

  const deps = {
    findAppId: (name: string): number | undefined => appList.findAppId(name),
    fetchDetails: fetchAppDetails,
    epicArtwork,
    pause: sleep,
    now: (): number => Math.floor(Date.now() / 1000)
  }

  for (;;) {
    const result = await runMetadataPass(games, metadata, deps)
    if (result.considered === 0) break

    console.log(`Metadata: ${result.succeeded} fetched, ${result.failed} without a match`)
    options.onProgress?.()

    if (result.rateLimited) {
      console.warn('Steam is throttling — pausing before the next pass.')
      await sleep(RATE_LIMIT_PAUSE_MS)
    } else {
      await sleep(BATCH_PAUSE_MS)
    }
  }

  console.log('Metadata: nothing left open.')
  options.onProgress?.()

  // Only afterwards: SteamGridDB should close the gaps still open after the
  // regular fetch. Before that it would not know which those are — and
  // every Steam hit brings its own image along anyway.
  await closeArtworkGaps(games, metadata, options)
}

/**
 * Fetches images for the games where nothing else remained.
 *
 * Measured on the development machine: after the full metadata pass, 17 of
 * 239 games have no image — 14 Steam titles whose store page no longer
 * exists (test branches, discontinued titles), two EA games and one Epic
 * game. 15 of them can be closed this way.
 *
 * Without a key nothing happens. That is not an error, just one image less.
 *
 * Exported as well as called from the service: the renderer discards images
 * that fail to load, and the gap that leaves has to be closable without
 * restarting the app. `createGapScheduler` is what calls it again.
 */
export async function closeArtworkGaps(
  games: GameRepository,
  metadata: MetadataRepository,
  options: MetadataServiceOptions
): Promise<void> {
  const apiKey = options.steamGridDbKey
  if (apiKey === undefined || apiKey === '') {
    console.log('Without a SteamGridDB key, games lacking a store image stay without one.')
    return
  }

  const sgdb = { apiKey }
  const deps = {
    lookupBySteamAppId: (appId: number) => lookupBySteamAppId(appId, sgdb),
    searchExact: (name: string) => searchExact(name, sgdb),
    fetchArtwork: (id: number) => fetchArtwork(id, sgdb),
    pause: sleep,
    pauseMs: SGDB_PAUSE_MS
  }

  for (;;) {
    const result = await runArtworkPass(games, metadata, deps)
    if (result.considered === 0) break

    console.log(`Images: ${result.found} closed, ${result.noMatch} without a match`)
    options.onProgress?.()
    await sleep(BATCH_PAUSE_MS)
  }

  console.log('Images: nothing left open.')
  options.onProgress?.()
}
