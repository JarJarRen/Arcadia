import { describe, expect, it } from 'vitest'
import {
  isSyntheticId,
  manualStoreGameId,
  storeGameIdLooksValid
} from '@shared/manual'

describe('manualStoreGameId', () => {
  it('builds a readable identifier from the name', () => {
    expect(manualStoreGameId('Dragon Age: Inquisition')).toBe('manual-dragon-age-inquisition')
  })

  it('gives the same name the same identifier every time', () => {
    // Favourites, manual matches and the merge key all hang off this. A
    // value that changed between runs would silently orphan them.
    expect(manualStoreGameId('Mass Effect')).toBe(manualStoreGameId('Mass Effect'))
  })

  it('keeps different names apart', () => {
    expect(manualStoreGameId('Battlefield 1')).not.toBe(manualStoreGameId('Battlefield V'))
  })

  it('survives punctuation, trademarks and doubled spaces', () => {
    expect(manualStoreGameId('EA SPORTS™  FC  26')).toBe('manual-ea-sports-fc-26')
  })

  it('keeps digits, which often carry the whole distinction', () => {
    expect(manualStoreGameId('FIFA 23')).toBe('manual-fifa-23')
    expect(manualStoreGameId('FIFA 24')).toBe('manual-fifa-24')
  })

  it('still produces something usable for a name with no usable characters', () => {
    // A name of pure punctuation must not collapse to "manual-", which
    // would collide with every other such name.
    const id = manualStoreGameId('!!! ???')
    expect(id.startsWith('manual-')).toBe(true)
    expect(id.length).toBeGreaterThan('manual-'.length)
  })
})

describe('isSyntheticId', () => {
  it('recognises a generated identifier', () => {
    expect(isSyntheticId(manualStoreGameId('Anything'))).toBe(true)
  })

  it('does not mistake a real store identifier for one', () => {
    // The distinction decides whether Play and Install appear at all.
    for (const real of ['16115019', '440', 'UE_5.7', '856']) {
      expect(isSyntheticId(real), real).toBe(false)
    }
  })
})

describe('storeGameIdLooksValid', () => {
  it('accepts the numeric identifiers of Steam, EA and Ubisoft', () => {
    expect(storeGameIdLooksValid('steam', '440')).toBe(true)
    expect(storeGameIdLooksValid('ea', '16115019')).toBe(true)
    expect(storeGameIdLooksValid('ubisoft', '856')).toBe(true)
  })

  it('accepts Epic identifiers, which are not numeric', () => {
    expect(storeGameIdLooksValid('epic', 'UE_5.7')).toBe(true)
    expect(storeGameIdLooksValid('epic', '4256d7c7170f4326a1a861d0b30f1af7')).toBe(true)
  })

  it('accepts a Microsoft package family name', () => {
    expect(storeGameIdLooksValid('microsoft', 'Microsoft.Forza_8wekyb3d8bbwe')).toBe(true)
  })

  it('rejects what must never reach a launch URI', () => {
    // The identifier ends up in a URI handed to the operating system's
    // shell. This is the same boundary the store adapters enforce, applied
    // before a hand-typed value can get anywhere near it.
    for (const bad of ['440; calc', '../../etc', 'a b', '', 'abc']) {
      expect(storeGameIdLooksValid('ea', bad), bad).toBe(false)
    }
    for (const bad of ['a b', 'a/b', 'a?b', '']) {
      expect(storeGameIdLooksValid('epic', bad), bad).toBe(false)
    }
    for (const bad of ['a b', 'a;calc', 'noSeparator', '', '_8wekyb3d8bbwe']) {
      expect(storeGameIdLooksValid('microsoft', bad), bad).toBe(false)
    }
  })
})

describe('storeless identifiers', () => {
  it('accepts a generated identifier', () => {
    expect(storeGameIdLooksValid('other', manualStoreGameId('Minecraft Launcher'))).toBe(true)
  })

  it('rejects anything a caller invents', () => {
    expect(storeGameIdLooksValid('other', 'C:\\Games\\mc.exe')).toBe(false)
    expect(storeGameIdLooksValid('other', '440')).toBe(false)
  })
})
