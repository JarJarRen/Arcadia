import { readFile } from 'node:fs/promises'
import { win32 } from 'node:path'
import { bytesField, numberField, parseMessage } from './protobuf'
import { ubisoftCacheDir } from './ownership'

/**
 * Names for Ubisoft games, from the launcher's own configuration cache.
 *
 * `cache\configuration\configurations` is protobuf holding one record per
 * game: field 1 is the numeric ID, field 3 a YAML document. 906 entries on
 * the development machine — the catalogue, not the library, so it says
 * nothing about ownership and is only ever used to put a name to an ID.
 *
 * This replaces guessing the name from the install folder. That guess was
 * all there was while only installed games existed, and it produced whatever
 * the folder happened to be called.
 *
 * The YAML is read with two regular expressions rather than a parser. A
 * dependency for two fields out of a 12 KB document would be poor value, and
 * the alternative — writing a YAML parser — would be worse.
 */

const NAME_FIELD = 1
const YAML_FIELD = 3

/**
 * Ubisoft's own placeholder for a game it has not named.
 *
 * Written literally into the configuration; entry 856 carries it on the
 * development machine. Treated as no name at all, so the game is dropped
 * rather than appearing in the library as "GAMENAME".
 */
const PLACEHOLDER = 'GAMENAME'

/** Localisation keys look like `l1`, `l2` — never a real title. */
const LOCALISATION_KEY = /^l\d+$/

/** Strips the quoting YAML allows around a scalar. */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      // Inside single quotes YAML escapes a quote by doubling it.
      return trimmed.slice(1, -1).replace(/''/g, "'")
    }
  }
  return trimmed
}

/**
 * The body of a block, from its header to the next line at the same or a
 * lower indent.
 */
function block(text: string, header: RegExp): string | undefined {
  const start = header.exec(text)
  if (start === null) return undefined
  const from = start.index + start[0].length
  const rest = text.slice(from)
  const indent = (start[1] ?? '').length
  // The next line indented no deeper than the header ends the block.
  const end = new RegExp(`\\n {0,${indent}}\\S`).exec(rest)
  return end === null ? rest : rest.slice(0, end.index)
}

/**
 * Resolves a localisation key against the document's own table.
 *
 * The wanted locale first, then `default`, which is English. Ubisoft labels
 * its blocks the way `t().format.locale` does — `de-DE`, `zh-CN` — so the
 * interface language can be handed straight in.
 */
function localised(yaml: string, key: string, locale: string): string | undefined {
  const table = block(yaml, /^()localizations:[^\n]*\n/m)
  if (table === undefined) return undefined

  for (const wanted of [locale, 'default']) {
    const section = block(table, new RegExp(`^( {2})${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[^\\n]*\\n`, 'm'))
    if (section === undefined) continue
    const hit = new RegExp(`^ {4}${key}:[ \\t]*(.+)$`, 'm').exec(section)
    if (hit?.[1] !== undefined) {
      const value = unquote(hit[1])
      if (value !== '') return value
    }
  }
  return undefined
}

/**
 * The display name for one configuration document.
 *
 * `root.name` is usually a key such as `l1` rather than a title, so the
 * localisation table decides. Where the name is written out literally it is
 * taken as it stands.
 */
export function nameFromConfiguration(yaml: string, locale = 'default'): string | undefined {
  const root = block(yaml, /^()root:[^\n]*\n/m)
  if (root === undefined) return undefined

  const declared = /^ {2}name:[ \t]*(.+)$/m.exec(root)?.[1]
  if (declared === undefined) return undefined

  const name = unquote(declared)
  const resolved = LOCALISATION_KEY.test(name) ? localised(yaml, name, locale) : name
  if (resolved === undefined || resolved === '' || resolved === PLACEHOLDER) return undefined
  return resolved
}

/** Numeric ID to configuration document. */
export function parseConfigurations(file: Buffer): Map<string, string> {
  const catalogue = new Map<string, string>()
  const records = parseMessage(file)
  if (records === undefined) return catalogue

  for (const record of records) {
    if (!Buffer.isBuffer(record.value)) continue
    const fields = parseMessage(record.value)
    if (fields === undefined) continue

    const id = numberField(fields, NAME_FIELD)
    const yaml = bytesField(fields, YAML_FIELD)
    if (id === undefined || id <= 0 || yaml === undefined) continue

    // The first record for an ID wins; later ones are variants.
    const key = String(id)
    if (!catalogue.has(key)) catalogue.set(key, yaml.toString('utf8'))
  }
  return catalogue
}

export interface CatalogueDeps {
  env?: NodeJS.ProcessEnv
  readBytes?: (path: string) => Promise<Buffer>
}

/**
 * Numeric ID to name, for every game the launcher has a configuration for.
 *
 * An empty map on any problem: without names the adapter falls back to the
 * install folder for what is installed, and simply reports nothing owned.
 */
export async function readUbisoftCatalogue(
  locale: string,
  deps: CatalogueDeps = {}
): Promise<Map<string, string>> {
  const readBytes = deps.readBytes ?? ((path: string): Promise<Buffer> => readFile(path))
  const path = win32.join(ubisoftCacheDir(deps.env), 'configuration', 'configurations')

  let file: Buffer
  try {
    file = await readBytes(path)
  } catch {
    return new Map()
  }

  const names = new Map<string, string>()
  for (const [id, yaml] of parseConfigurations(file)) {
    const name = nameFromConfiguration(yaml, locale)
    if (name !== undefined) names.set(id, name)
  }
  return names
}
