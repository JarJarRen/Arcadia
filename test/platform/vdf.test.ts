import { describe, expect, it } from 'vitest'
import { parseVdf, vdfNumber, vdfObject, vdfString } from '@main/platform/vdf'

describe('parseVdf', () => {
  it('reads flat key-value pairs', () => {
    expect(parseVdf('"a" "1"\n"b" "2"')).toEqual({ a: '1', b: '2' })
  })

  it('reads nested objects', () => {
    const input = `
"AppState"
{
\t"appid"\t\t"440"
\t"name"\t\t"Team Fortress 2"
}`
    expect(parseVdf(input)).toEqual({
      AppState: { appid: '440', name: 'Team Fortress 2' }
    })
  })

  it('reads objects nested several levels deep', () => {
    const input = `"users" { "765" { "AccountName" "testuser" } }`
    expect(parseVdf(input)).toEqual({
      users: { '765': { AccountName: 'testuser' } }
    })
  })

  it('ignores comment lines', () => {
    expect(parseVdf('// comment\n"a" "1" // another\n"b" "2"')).toEqual({ a: '1', b: '2' })
  })

  it('resolves escape sequences', () => {
    expect(parseVdf('"path" "F:\\\\steam"')).toEqual({ path: 'F:\\steam' })
    expect(parseVdf('"q" "say \\"hello\\""')).toEqual({ q: 'say "hello"' })
    expect(parseVdf('"nl" "a\\nb"')).toEqual({ nl: 'a\nb' })
  })

  it('accepts values without quotes', () => {
    expect(parseVdf('"a" 1')).toEqual({ a: '1' })
  })

  it('lets the last of duplicate keys win', () => {
    expect(parseVdf('"a" "1"\n"a" "2"')).toEqual({ a: '2' })
  })

  it('returns an empty object for empty input', () => {
    expect(parseVdf('')).toEqual({})
    expect(parseVdf('   \n\t  ')).toEqual({})
  })

  it('throws with a line number when a closing brace is missing', () => {
    expect(() => parseVdf('"a"\n{\n"b" "1"')).toThrow(/line 3/)
  })

  it('throws on an unterminated string', () => {
    expect(() => parseVdf('"a" "unfinished')).toThrow(/[Uu]nterminated/)
  })

  it('throws on a backslash at end of file', () => {
    // Exactly the line the undefined check in readQuoted hangs on.
    expect(() => parseVdf('"a" "x\\')).toThrow(/[Uu]nterminated/)
  })

  it('throws on an empty key', () => {
    expect(() => parseVdf('"" "1"')).toThrow(/[Ee]mpty key/)
  })

  it('throws when the value is missing', () => {
    expect(() => parseVdf('"a"')).toThrow(/Value for "a" is missing/)
  })

  it('throws on a surplus closing brace', () => {
    expect(() => parseVdf('"a" "1" }')).toThrow(/closing brace/)
  })
})

describe('parseVdf — robustness', () => {
  it('treats __proto__ as a perfectly ordinary key', () => {
    // With an object literal this key would overwrite the prototype and the
    // subtree would vanish without a trace.
    const result = parseVdf('"__proto__" { "inside" "yes" }')
    expect(Object.keys(result)).toEqual(['__proto__'])
    expect(vdfString(vdfObject(result, '__proto__')!, 'inside')).toBe('yes')
  })

  it('inherits nothing from Object.prototype', () => {
    // Check the prototype directly: a test on vdfString(result, 'toString')
    // would pass with a plain object literal too, because the typeof check
    // in vdfString filters out functions anyway — it would not notice the
    // regression at all.
    expect(Object.getPrototypeOf(parseVdf('"a" "1"'))).toBeNull()
    expect(Object.getPrototypeOf(vdfObject(parseVdf('"a" { "b" "1" }'), 'a')!)).toBeNull()
  })

  it('throws on nesting too deep rather than blowing the stack', () => {
    const deep = '"k" {'.repeat(200) + '}'.repeat(200)
    expect(() => parseVdf(deep)).toThrow(/Nesting/)
  })

  it('copes with permissibly deep nesting', () => {
    const ok = '"k" {'.repeat(50) + '}'.repeat(50)
    expect(() => parseVdf(ok)).not.toThrow()
  })

  it('ends unquoted values where a comment starts', () => {
    expect(parseVdf('"a" 1//comment')).toEqual({ a: '1' })
  })
})

describe('Access helpers', () => {
  const doc = parseVdf('"Root" { "Name" "X" "Count" "42" "Sub" { "k" "v" } }')
  const root = vdfObject(doc, 'Root')!

  it('finds keys regardless of capitalisation', () => {
    // Steam writes appid lower case and StateFlags mixed — depending on the
    // file and the version.
    expect(vdfString(root, 'name')).toBe('X')
    expect(vdfString(root, 'NAME')).toBe('X')
  })

  it('converts numbers', () => {
    expect(vdfNumber(root, 'Count')).toBe(42)
  })

  it('tells an empty value apart from the number 0', () => {
    // Number('') is 0 — without special handling "no value" would be
    // indistinguishable from "value 0".
    const empty = vdfObject(parseVdf('"R" { "X" "" }'), 'R')!
    expect(vdfNumber(empty, 'X')).toBeUndefined()
    const zero = vdfObject(parseVdf('"R" { "X" "0" }'), 'R')!
    expect(vdfNumber(zero, 'X')).toBe(0)
  })

  it('returns undefined instead of throwing when the type does not fit', () => {
    expect(vdfString(root, 'Sub')).toBeUndefined()
    expect(vdfObject(root, 'Name')).toBeUndefined()
    expect(vdfNumber(root, 'Name')).toBeUndefined()
    expect(vdfString(root, 'doesnotexist')).toBeUndefined()
  })
})
