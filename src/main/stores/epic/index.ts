import { access } from 'node:fs/promises'
import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import { scanEpicManifests } from './manifests'
import { readEpicCatalog } from './catalog'
import { epicCatalogFile, epicManifestDir } from './paths'

const SAFE_APP_NAME = /^[A-Za-z0-9_.-]+$/

export interface EpicAdapterDeps {
  manifestDir?: string
  catalogFile?: string
  scan?: (dir: string) => Promise<RawGame[]>
  readCatalog?: (path: string) => Promise<RawGame[]>
  exists?: (path: string) => Promise<boolean>
}

const defaultExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class EpicAdapter implements StoreAdapter {
  readonly id = 'epic' as const
  readonly displayName = 'Epic Games'

  private readonly manifestDir: string
  private readonly catalogFile: string
  private readonly scan: (dir: string) => Promise<RawGame[]>
  private readonly readCatalog: (path: string) => Promise<RawGame[]>
  private readonly exists: (path: string) => Promise<boolean>

  constructor(deps: EpicAdapterDeps = {}) {
    // Derived from PROGRAMDATA rather than hard-wired — see paths.ts.
    this.manifestDir = deps.manifestDir ?? epicManifestDir()
    this.catalogFile = deps.catalogFile ?? epicCatalogFile()
    this.scan = deps.scan ?? scanEpicManifests
    this.readCatalog = deps.readCatalog ?? readEpicCatalog
    this.exists = deps.exists ?? defaultExists
  }

  async isAvailable(): Promise<AvailabilityResult> {
    if (!(await this.exists(this.manifestDir))) {
      return { available: false, reason: t().stores.epic.notFound }
    }
    const limitations: string[] = []
    if (!(await this.exists(this.catalogFile))) {
      limitations.push(t().stores.epic.catalogCacheMissing)
    }
    return { available: true, limitations }
  }

  async scanInstalled(): Promise<RawGame[]> {
    if (!(await this.exists(this.manifestDir))) return []
    return this.scan(this.manifestDir)
  }

  /**
   * The owned library from Epic's catalogue cache.
   *
   * If the cache is missing or unreadable an empty list comes back rather
   * than an error: the installed games must stay unaffected. It surfaces
   * as a limitation in `isAvailable`.
   */
  async scanOwned(): Promise<RawGame[]> {
    return this.readCatalog(this.catalogFile)
  }

  launchUri(game: Game): string {
    // Launching goes through the AppName, not the catalogue ID. An owned
    // but uninstalled game has none — there is nothing to launch there, and
    // handing the shell an invented identifier would be worse than a clear
    // message.
    const appName = game.launchId
    if (appName === undefined || !SAFE_APP_NAME.test(appName)) {
      throw new Error(t().stores.epic.notInstalledCannotLaunch(game.name))
    }
    return `com.epicgames.launcher://apps/${appName}?action=launch&silent=true`
  }

  installUri(game: Game): string {
    // The same identifier as for launching. Since the catalogue supplies
    // it, uninstalled games have one too — 37 of 39 on the development
    // machine. The two without are honestly not installable, rather than
    // being attempted with an invented identifier.
    const appName = game.launchId
    if (appName === undefined || !SAFE_APP_NAME.test(appName)) {
      throw new Error(t().stores.epic.noCatalogId(game.name))
    }
    return `com.epicgames.launcher://apps/${appName}?action=install`
  }
}
