import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const csp = async (): Promise<string> => {
  const html = await readFile('src/renderer/index.html', 'utf8')
  return /Content-Security-Policy"[\s\S]*?content="([^"]+)"/.exec(html)?.[1] ?? ''
}

const directive = async (name: string): Promise<string> => {
  const match = new RegExp(`${name} ([^;"]+)`).exec(await csp())
  return match?.[1]?.trim() ?? ''
}

describe('Content-Security-Policy', () => {
  it('allows exactly the image hosts of the store sources', async () => {
    // Measured on the development machine, not guessed: cdn1.epicgames.com
    // (185 URLs), shared.akamai.steamstatic.com (148),
    // store.akamai.steamstatic.com (3), cdn2.steamgriddb.com (30).
    const imgSrc = await directive('img-src')
    for (const host of [
      'https://cdn1.epicgames.com',
      'https://*.akamai.steamstatic.com',
      'https://cdn2.steamgriddb.com',
      // The aggregator serves its own thumbnails; the free-games page is
      // the only place they appear.
      'https://www.gamerpower.com'
    ]) {
      expect(imgSrc, `${host} is missing`).toContain(host)
    }
  })

  it('does not open img-src to all hosts wholesale', async () => {
    // The URLs come from store data and are only half trustworthy. A
    // blanket https: would let a tampered URL reach out to any host.
    const imgSrc = await directive('img-src')
    expect(imgSrc).not.toMatch(/(^|\s)https:(\s|$)/)
    expect(imgSrc).not.toMatch(/(^|\s)\*(\s|$)/)
    // A star is only permissible as part of a host pattern.
    expect(imgSrc).toMatch(/https:\/\/\*\.akamai\.steamstatic\.com/)
  })

  it('leaves scripts and styles untouched', async () => {
    // The relaxation concerns images only. An accidentally opened
    // script-src would be an entirely different order of magnitude.
    const policy = await csp()
    expect(policy).toContain("default-src 'self'")
    expect(policy).not.toMatch(/script-src[^;]*https?:/)
    expect(await directive('style-src')).not.toMatch(/https?:/)
  })

  it('still allows own files and data URIs', async () => {
    const imgSrc = await directive('img-src')
    expect(imgSrc).toContain("'self'")
    expect(imgSrc).toContain('data:')
  })
})
