import { readFile } from 'node:fs/promises'
import type { ArtworkKind, ArtworkRef } from '@shared/metadata'

/**
 * Artwork from Epic's catalogue cache.
 *
 * The quickest win in the whole metadata plan: **no network call, no name
 * matching**. Measured on the development machine, all 37 Epic games carry
 * both main formats.
 *
 * Deliberately separate from `stores/epic/catalog.ts`, which reads the same
 * file for the game scan: the scan should not drag metadata along, and the
 * metadata should not depend on whatever shape the scan currently has.
 */
const GAME_CATEGORY = 'games'

/** Mapping of Epic's image types, measured on the development machine. */
const KIND_BY_TYPE: Record<string, ArtworkKind> = {
  // portrait, for the tile in the grid — 37 of 37
  DieselGameBoxTall: 'grid',
  // wide, for the details page — 37 of 37
  DieselGameBox: 'hero',
  // 1 of 37
  DieselGameBoxLogo: 'logo'
}

interface KeyImage {
  type?: unknown
  url?: unknown
}

interface CatalogEntry {
  id?: unknown
  categories?: unknown
  keyImages?: unknown
}

/**
 * Reads the image URLs per catalogue ID.
 *
 * The key of the mapping is the catalogue ID — the same one that
 * `parseEpicCatalog` assigns as `storeGameId`, and the one installed
 * manifests join on via `CatalogItemId`.
 */
export function parseEpicArtwork(base64: string): Map<string, ArtworkRef[]> {
  const result = new Map<string, ArtworkRef[]>()

  let entries: unknown
  try {
    entries = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch {
    return result
  }
  if (!Array.isArray(entries)) return result

  for (const raw of entries as CatalogEntry[]) {
    if (typeof raw !== 'object' || raw === null) continue

    const id = raw.id
    if (typeof id !== 'string' || id === '') continue

    const categories = raw.categories
    if (!Array.isArray(categories)) continue
    const isGame = categories.some(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        (c as { path?: unknown }).path === GAME_CATEGORY
    )
    if (!isGame) continue

    if (!Array.isArray(raw.keyImages)) continue

    const images: ArtworkRef[] = []
    for (const image of raw.keyImages as KeyImage[]) {
      if (typeof image !== 'object' || image === null) continue
      const kind = typeof image.type === 'string' ? KIND_BY_TYPE[image.type] : undefined
      if (kind === undefined) continue

      // The URL ends up in an img attribute. Only https is allowed — the
      // CSP would block anything else anyway, and do so silently.
      const url = image.url
      if (typeof url !== 'string' || !url.startsWith('https://')) continue

      if (images.some((existing) => existing.kind === kind)) continue
      images.push({ kind, url })
    }

    if (images.length > 0) result.set(id, images)
  }

  return result
}

export async function readEpicArtwork(path: string): Promise<Map<string, ArtworkRef[]>> {
  try {
    return parseEpicArtwork(await readFile(path, 'utf8'))
  } catch {
    return new Map()
  }
}
