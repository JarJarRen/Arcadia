import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseEpicArtwork, readEpicArtwork } from '@main/metadata/epicArtwork'

function catalogue(entries: unknown[]): string {
  return Buffer.from(JSON.stringify(entries), 'utf8').toString('base64')
}

const game = (id: string, images: Array<{ type: string; url: string }>): unknown => ({
  id,
  title: `Game ${id}`,
  entitlementName: `ent-${id}`,
  categories: [{ path: 'games' }],
  keyImages: images
})

describe('parseEpicArtwork', () => {
  it('maps the three Epic image types', () => {
    // Measured on the development machine: DieselGameBox and
    // DieselGameBoxTall on all 37 games, DieselGameBoxLogo on one.
    const result = parseEpicArtwork(
      catalogue([
        game('a', [
          { type: 'DieselGameBoxTall', url: 'https://cdn1.epicgames.com/tall.jpg' },
          { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/wide.jpg' },
          { type: 'DieselGameBoxLogo', url: 'https://cdn1.epicgames.com/logo.png' }
        ])
      ])
    )
    expect(result.get('a')).toEqual([
      { kind: 'grid', url: 'https://cdn1.epicgames.com/tall.jpg' },
      { kind: 'hero', url: 'https://cdn1.epicgames.com/wide.jpg' },
      { kind: 'logo', url: 'https://cdn1.epicgames.com/logo.png' }
    ])
  })

  it('passes over unknown image types', () => {
    const result = parseEpicArtwork(
      catalogue([
        game('a', [
          { type: 'Thumbnail', url: 'https://cdn1.epicgames.com/t.jpg' },
          { type: 'AndroidIcon', url: 'https://cdn1.epicgames.com/a.png' },
          { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/wide.jpg' }
        ])
      ])
    )
    expect(result.get('a')).toEqual([{ kind: 'hero', url: 'https://cdn1.epicgames.com/wide.jpg' }])
  })

  it('discards URLs that do not start with https', () => {
    // The URL travels into an img attribute. A file:// or a scheme-less
    // value has no business there — and the CSP would block it anyway,
    // silently.
    for (const url of ['file:///C:/x.png', 'http://insecure/x.png', '//schemeless/x.png', 'x.png']) {
      const result = parseEpicArtwork(catalogue([game('a', [{ type: 'DieselGameBox', url }])]))
      expect(result.get('a'), `URL ${url}`).toBeUndefined()
    }
  })

  it('takes only games, no engines or plugins', () => {
    const rest = [
      {
        id: 'ue',
        title: 'Unreal Engine',
        entitlementName: 'e',
        categories: [{ path: 'engines' }],
        keyImages: [{ type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/ue.jpg' }]
      }
    ]
    expect(parseEpicArtwork(catalogue(rest)).size).toBe(0)
  })

  it('simply leaves out a game without images', () => {
    const without = parseEpicArtwork(catalogue([game('a', [])]))
    expect(without.size).toBe(0)
  })

  it('returns an empty mapping for a broken catalogue', () => {
    // The format is undocumented. If it breaks, the artwork may be missing
    // — but nothing else may be dragged down with it.
    expect(parseEpicArtwork('not base64 !!!').size).toBe(0)
    expect(parseEpicArtwork(Buffer.from('{not json', 'utf8').toString('base64')).size).toBe(0)
    expect(parseEpicArtwork('').size).toBe(0)
  })

  it('returns an empty mapping for JSON that parses but is not an array', () => {
    // Valid JSON, wrong shape — distinct from the parse failures above,
    // which never reach the Array.isArray check at all.
    const notAnArray = Buffer.from(JSON.stringify({ apps: [] }), 'utf8').toString('base64')
    expect(parseEpicArtwork(notAnArray).size).toBe(0)
  })

  it('skips individual broken entries', () => {
    const mixed = [
      null,
      'not an object',
      // No id at all, and an empty one: both must be skipped rather than
      // written under a falsy key.
      { title: 'No id', entitlementName: 'e', categories: [{ path: 'games' }], keyImages: [] },
      { id: '', title: 'Empty id', entitlementName: 'e', categories: [{ path: 'games' }], keyImages: [] },
      // categories present but not an array.
      { id: 'bad-categories', title: 'X', entitlementName: 'e', categories: 'games', keyImages: [] },
      {
        id: 'ok',
        title: 'X',
        entitlementName: 'e',
        categories: [{ path: 'games' }],
        keyImages: 'not an array'
      },
      game(
        'good',
        // A non-object element in keyImages, and one with a non-string
        // type, must both be skipped without breaking the rest. Cast past
        // the helper's own type, which — rightly, for every other test in
        // this file — does not allow either.
        [
          'not an object',
          { type: 42, url: 'https://cdn1.epicgames.com/bad-type.jpg' },
          { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/g.jpg' },
          // A second image of the same kind is dropped, not appended twice.
          { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/g2.jpg' }
        ] as unknown as Array<{ type: string; url: string }>
      )
    ]
    const result = parseEpicArtwork(catalogue(mixed))
    expect([...result.keys()]).toEqual(['good'])
    expect(result.get('good')).toEqual([
      { kind: 'hero', url: 'https://cdn1.epicgames.com/g.jpg' }
    ])
  })
})

describe('readEpicArtwork', () => {
  let dir: string

  it('reads and parses a real catalogue file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-epic-artwork-'))
    const path = join(dir, 'catalog.dat')
    writeFileSync(path, catalogue([game('a', [{ type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/g.jpg' }])]), 'utf8')

    const result = await readEpicArtwork(path)

    expect(result.get('a')).toEqual([{ kind: 'hero', url: 'https://cdn1.epicgames.com/g.jpg' }])
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty mapping when the catalogue file is missing', async () => {
    const result = await readEpicArtwork('C:\\definitely\\does\\not\\exist\\catalog.dat')
    expect(result.size).toBe(0)
  })
})
