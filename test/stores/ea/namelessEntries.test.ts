import { describe, expect, it } from 'vitest'
import { readEaOffers } from '@main/stores/ea/registry'

/**
 * Two Origin Games keys: one named, one empty — the shape found on the
 * development machine, where 15 of 20 keys carry no values at all.
 */
function execStub(): (command: string) => Promise<string> {
  return async (command: string) => {
    const key = /reg query "([^"]+)"/.exec(command)?.[1] ?? ''
    const segment = key.split('\\').pop() ?? ''

    if (segment === 'Origin Games') {
      return [
        '',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games\\16115019',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games\\198235',
        ''
      ].join('\r\n')
    }
    if (segment === '16115019') {
      return `\r\n${key}\r\n    DisplayName    REG_SZ    EA SPORTS™ FIFA 23\r\n`
    }
    // Exactly the real case: the key exists and holds nothing.
    if (segment === '198235') return `\r\n${key}\r\n`
    throw new Error('not found')
  }
}

describe('readEaOffers with names mined from the launcher log', () => {
  it('still skips a nameless entry when nothing names it', () => {
    // Unchanged behaviour without the extra source: an entry with no name
    // would otherwise appear as an unreadable number in the library.
    return readEaOffers(execStub()).then((offers) => {
      expect(offers.map((o) => o.offerId)).toEqual(['16115019'])
    })
  })

  it('recovers the nameless entry when the log knows its title', async () => {
    const titles = new Map([['198235', 'EA SPORTS FC 24']])
    const offers = await readEaOffers(execStub(), titles)

    expect(offers.map((o) => o.offerId).sort()).toEqual(['16115019', '198235'])
    expect(offers.find((o) => o.offerId === '198235')?.name).toBe('EA SPORTS FC 24')
  })

  it('lets the registry name win over the mined one', async () => {
    // The registry is authoritative and current; the log is a record of
    // whatever the game was called when it was last launched.
    const titles = new Map([['16115019', 'FIFA 23 (old title from 2022)']])
    const offers = await readEaOffers(execStub(), titles)

    expect(offers.find((o) => o.offerId === '16115019')?.name).toBe('EA SPORTS™ FIFA 23')
  })

  it('ignores a mined title for an id the registry does not list', async () => {
    // The log reaches further back than the registry: a game uninstalled
    // long ago may still be named there. Without this the library would
    // show entries EA no longer knows about at all.
    const titles = new Map([['999999', 'Some Game Removed Long Ago']])
    const offers = await readEaOffers(execStub(), titles)

    expect(offers.map((o) => o.offerId)).toEqual(['16115019'])
  })
})
