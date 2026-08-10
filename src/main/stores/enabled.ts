import { parseEnabledStores } from '@shared/stores'
import type { StoreAdapter } from './types'

/**
 * The adapters a scan should be given.
 *
 * Takes the stored **string** rather than a SettingsRepository so it can be
 * tested without a database, and so both callers — the startup scan in
 * `main/index.ts` and the `library:sync` handler — filter identically.
 */
export function enabledAdapters(
  adapters: StoreAdapter[],
  stored: string | undefined
): StoreAdapter[] {
  const enabled = parseEnabledStores(stored)
  return adapters.filter((adapter) => enabled.includes(adapter.id))
}
