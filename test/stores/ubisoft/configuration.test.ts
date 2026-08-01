import { describe, expect, it } from 'vitest'
import {
  nameFromConfiguration,
  parseConfigurations,
  readUbisoftCatalogue
} from '@main/stores/ubisoft/configuration'

function varint(value: number): Buffer {
  const bytes: number[] = []
  let rest = value
  do {
    let byte = rest & 0x7f
    rest = Math.floor(rest / 128)
    if (rest > 0) byte |= 0x80
    bytes.push(byte)
  } while (rest > 0)
  return Buffer.from(bytes)
}
const tag = (field: number, wire: number): Buffer => varint((field << 3) | wire)
const entry = (id: number, yaml: string): Buffer => {
  const text = Buffer.from(yaml, 'utf8')
  const body = Buffer.concat([
    Buffer.concat([tag(1, 0), varint(id)]),
    Buffer.concat([tag(3, 2), varint(text.length), text])
  ])
  return Buffer.concat([tag(1, 2), varint(body.length), body])
}

/** Shaped like the real document for Rainbow Six Siege (id 635). */
const LOCALISED = `version: 2.0
root:
  name: l1
  thumb_image: l2
  start_game:
    online:
      executables:
      - shortcut_name: Tom Clancy's Rainbow Six Siege
localizations:
  default:
    l1: Tom Clancy's Rainbow Six® Siege
    l2: a1f13207.png
  de-DE:
    l1: Tom Clancy's Rainbow Six® Siege (Deutsch)
  zh-CN:
    l1: 彩虹六号：围攻
`

const LITERAL = `version: 2.0
root:
  name: "Assassin's Creed II"
  sort_string: "Assassin's Creed 02"
`

describe('Ubisoft configuration names', () => {
  it('resolves a localisation key through the document’s own table', () => {
    // root.name is `l1`, not a title — the common case, and the difference
    // between 6 and 16 usable names out of 17.
    expect(nameFromConfiguration(LOCALISED)).toBe("Tom Clancy's Rainbow Six® Siege")
  })

  it('prefers the interface language and falls back to default', () => {
    expect(nameFromConfiguration(LOCALISED, 'de-DE')).toBe(
      "Tom Clancy's Rainbow Six® Siege (Deutsch)"
    )
    expect(nameFromConfiguration(LOCALISED, 'zh-CN')).toBe('彩虹六号：围攻')
    // A language the document does not carry falls back rather than failing.
    expect(nameFromConfiguration(LOCALISED, 'en-GB')).toBe("Tom Clancy's Rainbow Six® Siege")
  })

  it('takes a name that is written out literally', () => {
    expect(nameFromConfiguration(LITERAL)).toBe("Assassin's Creed II")
  })

  it('unquotes single-quoted values and their doubled quotes', () => {
    const yaml = "version: 2.0\nroot:\n  name: 'For Honor - Open Test: Marching Fire'\n"
    expect(nameFromConfiguration(yaml)).toBe('For Honor - Open Test: Marching Fire')
    const doubled = "version: 2.0\nroot:\n  name: 'Assassin''s Creed'\n"
    expect(nameFromConfiguration(doubled)).toBe("Assassin's Creed")
  })

  it('treats Ubisoft’s own placeholder as no name', () => {
    // Entry 856 carries this literally. A library row reading "GAMENAME"
    // would be worse than leaving the game out.
    expect(nameFromConfiguration('version: 2.0\nroot:\n  name: GAMENAME\n')).toBeUndefined()
  })

  it('returns undefined when there is nothing to read', () => {
    expect(nameFromConfiguration('')).toBeUndefined()
    expect(nameFromConfiguration('version: 2.0\nroot:\n  thumb_image: x.png\n')).toBeUndefined()
    // A key with no localisation table behind it resolves to nothing.
    expect(nameFromConfiguration('version: 2.0\nroot:\n  name: l1\n')).toBeUndefined()
  })

  it('does not take a name from a different top-level section', () => {
    const yaml = 'version: 2.0\nroot:\n  thumb_image: x.png\nother:\n  name: Wrong\n'
    expect(nameFromConfiguration(yaml)).toBeUndefined()
  })

  it('maps IDs to documents', () => {
    const file = Buffer.concat([entry(4, LITERAL), entry(635, LOCALISED)])
    const catalogue = parseConfigurations(file)
    expect([...catalogue.keys()]).toEqual(['4', '635'])
  })

  it('keeps the first record for an ID', () => {
    const file = Buffer.concat([entry(4, LITERAL), entry(4, LOCALISED)])
    expect(nameFromConfiguration(parseConfigurations(file).get('4')!)).toBe("Assassin's Creed II")
  })

  it('returns an empty catalogue for a file that is not protobuf', () => {
    expect(parseConfigurations(Buffer.from('nonsense', 'utf8')).size).toBe(0)
  })

  it('reads names for the wanted locale', async () => {
    const names = await readUbisoftCatalogue('de-DE', {
      env: { LOCALAPPDATA: 'C:\\Local' } as NodeJS.ProcessEnv,
      readBytes: async () => Buffer.concat([entry(4, LITERAL), entry(635, LOCALISED)])
    })
    expect(names.get('4')).toBe("Assassin's Creed II")
    expect(names.get('635')).toBe("Tom Clancy's Rainbow Six® Siege (Deutsch)")
  })

  it('returns an empty map when the cache is missing', async () => {
    const names = await readUbisoftCatalogue('en-GB', {
      env: { LOCALAPPDATA: 'C:\\Local' } as NodeJS.ProcessEnv,
      readBytes: async () => {
        throw new Error('ENOENT')
      }
    })
    expect(names.size).toBe(0)
  })
})
