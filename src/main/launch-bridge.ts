import { shell } from 'electron'
import type { Game } from '@shared/types'
import type { LaunchResult } from '@shared/ipc'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'

/**
 * Runs an adapter's launch URI.
 *
 * This file is the only place where adapter output meets Electron — which
 * is what lets the adapters themselves stay Electron-free, and therefore
 * testable without Electron.
 */
export async function launchGame(
  adapters: StoreAdapter[],
  game: Game
): Promise<LaunchResult> {
  return open(adapters, game, 'launch')
}

/**
 * Opens the store's install dialog.
 *
 * Arcadia downloads nothing itself — it hands the store the same kind of
 * URI as for launching, only with a different verb.
 */
export async function installGame(
  adapters: StoreAdapter[],
  game: Game
): Promise<LaunchResult> {
  return open(adapters, game, 'install')
}

async function open(
  adapters: StoreAdapter[],
  game: Game,
  action: 'launch' | 'install'
): Promise<LaunchResult> {
  const adapter = adapters.find((candidate) => candidate.id === game.storeId)
  if (adapter === undefined) {
    return { ok: false, error: t().errors.noAdapter(game.storeId) }
  }

  // Building the URI validates the game ID and throws on invalid values —
  // which is why it sits inside the try. Otherwise the error would reach
  // the renderer as a rejected promise instead of a clean message.
  let uri: string | undefined
  try {
    uri = action === 'launch' ? adapter.launchUri(game) : adapter.installUri(game)
    await shell.openExternal(uri)
    const notice = action === 'install' ? adapter.installNotice : undefined
    return notice === undefined ? { ok: true } : { ok: true, notice }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Include the URI whenever it was produced: without it a failure is
    // impossible to trace.
    if (uri === undefined) {
      return {
        ok: false,
        error:
          action === 'launch'
            ? t().errors.launchNameFailed(game.name, message)
            : t().errors.installNameFailed(game.name, message)
      }
    }
    return {
      ok: false,
      error:
        action === 'launch'
          ? t().errors.launchUriFailed(uri, message)
          : t().errors.installUriFailed(uri, message)
    }
  }
}
