export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  '\\': '\\',
  '"': '"'
}

/** Guards against a stack overflow from deliberately deep nesting. */
const MAX_DEPTH = 100

/**
 * Parses Valve Data Format (KeyValues), as Steam uses it for
 * appmanifest_*.acf, libraryfolders.vdf and loginusers.vdf.
 *
 * Escape handling: `\\`, `\"`, `\n` and `\t` are decoded per the format.
 * Any other sequence is taken literally rather than throwing — a hard
 * error would otherwise make the entire library invisible because of one
 * unusual line.
 *
 * **The limit of that tolerance:** a Windows path with a single backslash
 * before `n` or `t` (`C:\temp`) is read as an escape and thereby corrupted.
 * That is unavoidable — the sequence is indistinguishable from a real
 * escape.
 *
 * Steam itself escapes correctly with doubled backslashes; verified in
 * `libraryfolders.vdf` on the development machine, where the path is
 * written with `\\`. So the case does not arise for Steam-generated files,
 * only for hand-written ones.
 */
export function parseVdf(input: string): VdfObject {
  let pos = 0

  const lineAt = (): number => {
    let line = 1
    for (let i = 0; i < pos && i < input.length; i++) {
      if (input[i] === '\n') line++
    }
    return line
  }

  // Deliberately a function declaration rather than a const arrow:
  // TypeScript only narrows types after calling a never-returning function
  // when that function is a declaration or carries an explicit type
  // annotation. As a const arrow, `next` in readQuoted would stay
  // `string | undefined` despite the undefined check, and the typecheck
  // would fail with TS2538. Verified against TypeScript 7.0.2.
  function fail(message: string): never {
    throw new Error(`VDF parse error on line ${lineAt()}: ${message}`)
  }

  const skipTrivia = (): void => {
    for (;;) {
      while (pos < input.length && /\s/.test(input[pos] as string)) pos++
      if (input[pos] === '/' && input[pos + 1] === '/') {
        while (pos < input.length && input[pos] !== '\n') pos++
        continue
      }
      return
    }
  }

  const readQuoted = (): string => {
    pos++ // opening quote
    let out = ''
    while (pos < input.length) {
      const ch = input[pos] as string
      if (ch === '\\') {
        const next = input[pos + 1]
        if (next === undefined) fail('Unterminated string')
        out += ESCAPES[next] ?? next
        pos += 2
        continue
      }
      if (ch === '"') {
        pos++
        return out
      }
      out += ch
      pos++
    }
    return fail('Unterminated string')
  }

  const readBare = (): string => {
    let out = ''
    while (pos < input.length) {
      const ch = input[pos] as string
      if (/[\s"{}]/.test(ch)) break
      // A comment also ends an unquoted value — otherwise "1//comment"
      // would end up in the output as the value "1//comment".
      if (ch === '/' && input[pos + 1] === '/') break
      out += ch
      pos++
    }
    return out
  }

  const readObject = (depth: number): VdfObject => {
    if (depth > MAX_DEPTH) {
      fail(`Nesting deeper than ${MAX_DEPTH} levels`)
    }
    // Object.create(null) rather than {}: with a literal, a VDF key named
    // "__proto__" would overwrite the prototype instead of creating a
    // field. The whole subtree would then be invisible — silent data loss
    // without any error message, the worst possible behaviour for a parser.
    const obj: VdfObject = Object.create(null) as VdfObject
    for (;;) {
      skipTrivia()
      if (pos >= input.length) {
        if (depth > 0) fail('Unexpected end of file, closing brace missing')
        return obj
      }
      if (input[pos] === '}') {
        if (depth === 0) fail('Unexpected closing brace')
        pos++
        return obj
      }

      const key = input[pos] === '"' ? readQuoted() : readBare()
      if (key === '') fail('Empty key')

      skipTrivia()
      if (pos >= input.length) fail(`Value for "${key}" is missing`)

      if (input[pos] === '{') {
        pos++
        obj[key] = readObject(depth + 1)
      } else if (input[pos] === '"') {
        obj[key] = readQuoted()
      } else {
        obj[key] = readBare()
      }
    }
  }

  return readObject(0)
}

/** Key lookup that ignores case. */
function lookup(obj: VdfObject, key: string): VdfValue | undefined {
  const direct = obj[key]
  if (direct !== undefined) return direct
  const lower = key.toLowerCase()
  for (const candidate of Object.keys(obj)) {
    if (candidate.toLowerCase() === lower) return obj[candidate]
  }
  return undefined
}

export function vdfObject(obj: VdfObject, key: string): VdfObject | undefined {
  const value = lookup(obj, key)
  return typeof value === 'object' ? value : undefined
}

export function vdfString(obj: VdfObject, key: string): string | undefined {
  const value = lookup(obj, key)
  return typeof value === 'string' ? value : undefined
}

export function vdfNumber(obj: VdfObject, key: string): number | undefined {
  const value = vdfString(obj, key)
  if (value === undefined) return undefined
  // Number('') is 0 — without this check an empty value would pass as a
  // genuine zero and make "no value" indistinguishable from "value 0".
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}
