import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

describe('Scaffolding', () => {
  it('has every entry point', () => {
    expect(existsSync('src/main/index.ts')).toBe(true)
    expect(existsSync('src/preload/index.ts')).toBe(true)
    expect(existsSync('src/renderer/main.tsx')).toBe(true)
  })

  // The security settings are no longer checked here: they now live as data
  // in src/main/window-options.ts and are asserted directly on the value in
  // test/shared/ipc.test.ts, instead of searching the source for strings. A
  // text match was no proof — a second, insecure window would have gone
  // unnoticed.

  it('never commits the .env', async () => {
    const ignore = await readFile('.gitignore', 'utf8')
    expect(ignore).toMatch(/^\.env$/m)
  })
})
