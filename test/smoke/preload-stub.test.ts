/**
 * Keeps the smoke test's fake bridge in step with the real one.
 *
 * The smoke test supplies its own `window.arcadia` — a plain .cjs, loaded by
 * Electron, which TypeScript never looks at. So a channel added to
 * `ArcadiaApi` and implemented in `src/preload/index.ts` reaches the smoke
 * stub only if somebody remembers, and nothing at all complains when nobody
 * does. It has now been missed twice: `getLanguage` when the renderer
 * learned to start in the persisted language, and `isScanning` when it
 * learned to report a running scan.
 *
 * What made that expensive is how it fails. The renderer calls the missing
 * function inside a `useEffect`, the throw has no error boundary above it,
 * React unmounts the entire root, and the smoke test goes on measuring an
 * empty document until some later script reaches for an element that is not
 * there. The reported failure is a null `.click()` several hundred lines
 * from the cause.
 *
 * The real preload is the source of truth rather than the `ArcadiaApi` type:
 * a type is erased before anything runs and cannot be enumerated, whereas
 * `src/preload/index.ts` declares `const api: ArcadiaApi`, so tsc has already
 * proved that object carries every member. Reading its keys back turns that
 * guarantee into a runtime list.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/** Whatever the preload hands to `exposeInMainWorld`. */
let exposed: Record<string, unknown> = {}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      exposed = api
    }
  },
  ipcRenderer: {
    invoke: async () => undefined,
    on: () => undefined,
    removeListener: () => undefined
  }
}))

const STUB_PATH = join(__dirname, 'preload.cjs')

beforeAll(async () => {
  // Imported for its side effect: the module calls exposeInMainWorld as it
  // is evaluated, which the mock above captures.
  await import('../../src/preload/index')
})

describe('the smoke test bridge', () => {
  it('exposes something to compare against', () => {
    // Guards the guard: a mock that stopped capturing would leave `exposed`
    // empty, and every assertion below would pass by vacuum.
    expect(Object.keys(exposed).length).toBeGreaterThan(15)
  })

  it('implements every channel the real preload does', () => {
    const stub = readFileSync(STUB_PATH, 'utf8')

    // Matched as a property declaration rather than a bare mention, so a
    // name that appears only inside a comment does not count as implemented.
    const missing = Object.keys(exposed).filter(
      (name) => !new RegExp(`^\\s*${name}\\s*:`, 'm').test(stub)
    )

    expect(missing, `test/smoke/preload.cjs is missing: ${missing.join(', ')}`).toEqual([])
  })
})
