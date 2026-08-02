/**
 * Builders for a library entry and its store rows.
 *
 * Shared by the filter tests, which run under Node, and by the component
 * tests, which run under jsdom — hence a .ts with no DOM in it. They began
 * as local helpers in filter.test.ts and were lifted here unchanged when
 * the renderer tests needed the same two shapes.
 */
import type { Game, StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'

export function game(storeId: StoreId, id: string, name: string, o: Partial<Game> = {}): Game {
  return {
    id: `${storeId}:${id}`,
    storeId,
    storeGameId: id,
    name,
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    ...o
  }
}

/** Builds an entry from any number of sources. */
export function entry(
  name: string,
  sources: Game[],
  o: Partial<LibraryEntry> = {}
): LibraryEntry {
  const active = sources[0]!
  return {
    key: name.toLowerCase(),
    sources,
    active,
    name,
    installed: sources.some((s) => s.installed),
    favorite: sources.some((s) => s.favorite),
    installPath: active.installPath,
    installSizeBytes: active.installSizeBytes,
    playtimeMinutes: active.playtimeMinutes,
    lastPlayed: active.lastPlayed,
    artwork: [],
    sharedOrFree: false,
    ...o
  }
}
