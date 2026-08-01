/**
 * The settings the configuration screen edits.
 *
 * Shared because both processes need the list: the main process parses and
 * writes them, the renderer draws one field per key. A second copy in the
 * renderer would drift the moment a fourth key arrives.
 */

export const ENV_CONFIG_KEYS = [
  'STEAM_WEB_API_KEY',
  'STEAM_ID64',
  'STEAMGRIDDB_API_KEY'
] as const

export type EnvConfigKey = (typeof ENV_CONFIG_KEYS)[number]

export type EnvConfigValues = Record<EnvConfigKey, string>

/**
 * The marker that says the question has been answered.
 *
 * Spelled like its three neighbours rather than `env-config-done`: dotenv
 * would parse the hyphenated form, but it would be the one lowercase key in
 * the file and every read of it would need bracket syntax.
 *
 * Its absence — not a `false` — is what opens the screen. Skipping writes
 * `true` just as saving does: the user answered, and being asked again on
 * every start would be the opposite of what skipping means.
 */
export const ENV_CONFIG_DONE = 'ENV_CONFIG_DONE'

export interface EnvConfigState {
  done: boolean
  values: EnvConfigValues
  /** Shown in the dialog, so it is clear which file is being edited. */
  path: string
}

export interface EnvConfigSaveResult {
  ok: boolean
  error?: string
  /**
   * Whether the app is restarting to pick the values up.
   *
   * Only true when something actually changed. The keys are read once at
   * startup and handed to the store adapters, so a running Arcadia holds
   * the old ones — but skipping, or closing the dialog unchanged, gives the
   * process nothing new to read.
   */
  restarting: boolean
}

/** Every key empty — the state of a machine with no `.env` at all. */
export function emptyEnvConfig(): EnvConfigValues {
  return { STEAM_WEB_API_KEY: '', STEAM_ID64: '', STEAMGRIDDB_API_KEY: '' }
}
