import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  ENV_CONFIG_DONE,
  ENV_CONFIG_KEYS,
  emptyEnvConfig,
  type EnvConfigState,
  type EnvConfigValues
} from '@shared/env-config'
import { applyEnvValues, envTargetPath, parseEnvFile } from '@main/env-file'

/**
 * Reading and writing the `.env` the configuration screen edits.
 *
 * Kept apart from `env-file.ts`, which is pure text and path arithmetic:
 * this is the thin layer that actually touches the disk, and it is thin so
 * that almost everything worth testing is tested without one.
 *
 * Synchronous on purpose. The file is a few hundred bytes, it is read once
 * at startup and written once when a dialog closes, and the two callers —
 * an IPC handler and the startup gate — would gain nothing from being able
 * to interleave anything with it.
 */

/** The text of the first candidate that exists, if any. */
function currentFile(candidates: string[]): { path: string; text: string } {
  const path = envTargetPath(candidates, existsSync)
  return { path, text: existsSync(path) ? readFileSync(path, 'utf8') : '' }
}

export function readEnvConfig(candidates: string[]): EnvConfigState {
  const { path, text } = currentFile(candidates)
  const parsed = parseEnvFile(text)

  const values = emptyEnvConfig()
  for (const key of ENV_CONFIG_KEYS) values[key] = parsed[key] ?? ''

  // Only the exact string counts. Anything else is a file somebody edited by
  // hand into a state this cannot interpret, and asking again is the safer
  // reading of it.
  return { done: parsed[ENV_CONFIG_DONE] === 'true', values, path }
}

/**
 * Writes the marker, and the values when there are any.
 *
 * `undefined` is the skip: the question counts as answered, but nothing the
 * user never filled in is written over what the file already holds.
 *
 * `changed` says whether any value actually differs from what was there.
 * The caller restarts the app on a change and only then — the keys are read
 * once at startup, so a save that changed nothing gives the new process
 * nothing to find.
 */
export function saveEnvConfig(
  candidates: string[],
  values: EnvConfigValues | undefined
): { path: string; changed: boolean } {
  const { path, text } = currentFile(candidates)
  const before = parseEnvFile(text)

  const write: Record<string, string> = { [ENV_CONFIG_DONE]: 'true' }
  let changed = false

  if (values !== undefined) {
    for (const key of ENV_CONFIG_KEYS) {
      const value = (values[key] ?? '').trim()
      write[key] = value
      if (value !== (before[key] ?? '')) changed = true
    }
  }

  // applyEnvValues throws on a value that cannot be written — a line break
  // would turn the rest into a variable of its own. Deliberately before the
  // write, so a rejected value leaves the file exactly as it was.
  writeFileSync(path, applyEnvValues(text, write), 'utf8')

  return { path, changed }
}
