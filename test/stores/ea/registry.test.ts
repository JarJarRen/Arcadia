import { describe, expect, it } from 'vitest'
import { matchOffersToInstalls, normalizeForMatch } from '@main/stores/ea/registry'

describe('normalizeForMatch', () => {
  it('strips trademark symbols and normalises punctuation', () => {
    // Exactly the case from the development machine: the Origin registry
    // writes a colon, the uninstall registry a hyphen.
    expect(normalizeForMatch('STAR WARS Jedi: Fallen Order™')).toBe(
      normalizeForMatch('STAR WARS Jedi - Fallen Order™')
    )
  })

  it('ignores case and repeated spaces', () => {
    expect(normalizeForMatch('EA  SPORTS   FC™ 26')).toBe(normalizeForMatch('ea sports fc 26'))
  })

  it('leaves different games different', () => {
    expect(normalizeForMatch('FIFA 23')).not.toBe(normalizeForMatch('FIFA 24'))
    expect(normalizeForMatch('Battlefield 1')).not.toBe(normalizeForMatch('Battlefield V'))
  })
})

describe('matchOffersToInstalls', () => {
  const offers = [
    { offerId: '196485', name: 'STAR WARS Jedi: Fallen Order™' },
    { offerId: '16425677', name: 'EA SPORTS FC™ 26 The World‘s Game Edition' },
    { offerId: '16115019', name: 'EA SPORTS™ FIFA 23' },
    { offerId: '16050355', name: 'It Takes Two' }
  ]
  const installs = [
    { name: 'STAR WARS Jedi - Fallen Order™', installPath: 'G:\\origin\\Jedi Fallen Order\\' },
    { name: 'EA SPORTS FC 26', installPath: 'M:\\EA SPORTS FC 26\\', sizeBytes: 62_000_000_000 }
  ]

  it('links via the normalised name despite differing punctuation', () => {
    const games = matchOffersToInstalls(offers, installs)
    const jedi = games.find((g) => g.storeGameId === '196485')!
    expect(jedi.installed).toBe(true)
    expect(jedi.installPath).toBe('G:\\origin\\Jedi Fallen Order\\')
  })

  it('links via the prefix when a name carries an edition suffix', () => {
    // Origin calls it "… FC™ 26 The World's Game Edition", the uninstall
    // registry only "EA SPORTS FC 26".
    const fc = matchOffersToInstalls(offers, installs).find((g) => g.storeGameId === '16425677')!
    expect(fc.installed).toBe(true)
    expect(fc.installSizeBytes).toBe(62_000_000_000)
  })

  it('reports offers without an installation as not installed', () => {
    // FIFA 23 is registered on the development machine, but the folder is
    // gone.
    const fifa = matchOffersToInstalls(offers, installs).find((g) => g.storeGameId === '16115019')!
    expect(fifa.installed).toBe(false)
    expect(fifa.installPath).toBeUndefined()
  })

  it('keeps the name from the Origin registry, not the uninstall one', () => {
    // The Origin names are the more complete ones.
    const jedi = matchOffersToInstalls(offers, installs).find((g) => g.storeGameId === '196485')!
    expect(jedi.name).toBe('STAR WARS Jedi: Fallen Order™')
  })

  it('links an installation at most once', () => {
    const duplicates = [
      { offerId: '1', name: 'Same Game' },
      { offerId: '2', name: 'Same Game' }
    ]
    const games = matchOffersToInstalls(duplicates, [
      { name: 'Same Game', installPath: 'X:\\' }
    ])
    expect(games.filter((g) => g.installed)).toHaveLength(1)
  })
})
