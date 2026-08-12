import type { Game, RawGame } from '@shared/types'
import type { StoreScanResult, SyncResult } from '@shared/sync-types'
import type { StoreAdapter } from '@main/stores/types'
import type { GameRepository } from '@main/db/repository'

export type { StoreScanResult, SyncResult }

/**
 * Merges a store's installed and owned games.
 *
 * The local scan wins on install state and path — the API does not know
 * what sits on disk. The API contributes playtime and "last played", which
 * are not available locally.
 */
function merge(installed: RawGame[], owned: RawGame[]): RawGame[] {
  const merged = new Map<string, RawGame>()

  for (const game of owned) {
    merged.set(game.storeGameId, { ...game })
  }

  for (const game of installed) {
    const existing = merged.get(game.storeGameId)
    if (existing === undefined) {
      merged.set(game.storeGameId, { ...game })
      continue
    }
    merged.set(game.storeGameId, {
      ...existing,
      ...game,
      // Values only the API knows must not be overwritten by the local
      // scan.
      playtimeMinutes: game.playtimeMinutes ?? existing.playtimeMinutes,
      lastPlayed: game.lastPlayed ?? existing.lastPlayed,
      // Conversely, only the local scan knows the launch identifier:
      // Epic's AppName lives in the manifest, not in the catalogue.
      launchId: game.launchId ?? existing.launchId
    })
  }

  return [...merged.values()]
}

async function scanOne(
  adapter: StoreAdapter,
  repo: GameRepository,
  now: number
): Promise<StoreScanResult> {
  const availability = await adapter.isAvailable()
  if (!availability.available) {
    // Not an error: a store that does not exist on this platform is a
    // known state, not a malfunction.
    //
    // It also matters that this returns BEFORE upsertScan: otherwise a
    // temporarily unreachable store — on a disconnected drive, say — would
    // mark its entire library as uninstalled.
    return { storeId: adapter.id, ok: true, games: 0 }
  }

  const installed = await adapter.scanInstalled()

  let owned: RawGame[] = []
  let ownedError: string | undefined
  if (adapter.scanOwned !== undefined) {
    try {
      owned = await adapter.scanOwned()
    } catch (error) {
      // Partial success: the installed games are written regardless.
      ownedError = error instanceof Error ? error.message : String(error)
    }
  }

  const games = merge(installed, owned)
  repo.upsertScan(adapter.id, games, now)

  const result: StoreScanResult = {
    storeId: adapter.id,
    ok: ownedError === undefined,
    games: games.length
  }
  if (ownedError !== undefined) result.error = ownedError
  return result
}

export async function runSync(
  adapters: StoreAdapter[],
  repo: GameRepository,
  now: number,
  /**
   * Run after the scan has been written, with the library as it now
   * stands.
   *
   * Optional, and its failure is swallowed: confirming a freebie claim is
   * a nicety, and a broken one must not fail a scan of 200 games.
   */
  afterScan?: (games: Game[]) => void
): Promise<SyncResult> {
  const settled = await Promise.allSettled(
    adapters.map((adapter) => scanOne(adapter, repo, now))
  )

  const stores: StoreScanResult[] = settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') return outcome.value
    const reason: unknown = outcome.reason
    return {
      storeId: adapters[index]!.id,
      ok: false,
      games: 0,
      error: reason instanceof Error ? reason.message : String(reason)
    }
  })

  if (afterScan !== undefined) {
    try {
      // `all()` is the repository's existing reader for the whole library.
      afterScan(repo.all())
    } catch (error) {
      console.error('The freebie claims could not be confirmed:', error)
    }
  }

  return {
    stores,
    totalGames: stores.reduce((sum, store) => sum + store.games, 0)
  }
}
