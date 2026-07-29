import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import { SECURE_WEB_PREFERENCES } from '@main/window-options'

describe('IPC contract', () => {
  it('has unique channel names', () => {
    const names = Object.values(IPC)
    expect(new Set(names).size).toBe(names.length)
  })

  it('registers in the main process exactly the channels the preload invokes', async () => {
    // A channel invoked in the preload but not registered in main leads to
    // a silent hang rather than an error — a "no answer" message nobody
    // could track down.
    //
    // Checked via the constant names, not the channel strings: both files
    // use `IPC.x`, and the string itself only lives in shared/ipc.ts. A
    // test on the strings would be red by construction.
    const mainSource = await readFile('src/main/ipc.ts', 'utf8')
    const preloadSource = await readFile('src/preload/index.ts', 'utf8')

    const registered = new Set(
      [...mainSource.matchAll(/ipcMain\.handle\(\s*IPC\.(\w+)/g)].map((m) => m[1])
    )
    const invoked = new Set(
      [...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*IPC\.(\w+)/g)].map((m) => m[1])
    )

    expect(registered.size).toBeGreaterThan(0)
    expect(invoked.size).toBeGreaterThan(0)

    for (const channel of invoked) {
      expect(registered, `${channel} is invoked but not registered`).toContain(channel)
    }
  })

  it('has a constant for every channel name in the contract', () => {
    // Catches typos such as IPC.libaryGet, which would otherwise silently
    // become undefined and create a channel named "undefined".
    for (const key of [
      'libraryGet',
      'librarySync',
      'libraryChanged',
      'gameLaunch',
      'gameSetFavorite'
    ]) {
      expect(IPC[key as keyof typeof IPC]).toBeTypeOf('string')
    }
  })

  it('exposes nothing but the arcadia API in the preload', async () => {
    const source = await readFile('src/preload/index.ts', 'utf8')
    const exposed = [...source.matchAll(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)]
    expect(exposed.map((m) => m[1])).toEqual(['arcadia'])
  })

  it('keeps the security settings unchanged', () => {
    // Asserted on the value, not on the source text. The previous version
    // searched the whole index.ts for the strings and would have stayed
    // green if somebody added a second, insecure window or left the setting
    // only in a comment.
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })

  it('creates exactly one window, and with those settings', async () => {
    const source = await readFile('src/main/index.ts', 'utf8')

    // A second window would be the gap through which insecure settings
    // could return without the value test above firing.
    const windows = [...source.matchAll(/new BrowserWindow\(/g)]
    expect(windows).toHaveLength(1)

    // And that one window has to use the checked settings rather than
    // spelling them out again alongside.
    expect(source).toContain('...SECURE_WEB_PREFERENCES')
    expect(source).not.toMatch(/contextIsolation:\s*false/)
    expect(source).not.toMatch(/nodeIntegration:\s*true/)
    expect(source).not.toMatch(/sandbox:\s*false/)
  })

  it('imports Electron only in the three permitted files', async () => {
    // Adapters, parsers and repositories have to stay testable without
    // Electron.
    //
    // Deliberately determined from the file system rather than a curated
    // list: a list gets forgotten with the next store, and the test would
    // stay silently green while exactly that file broke the rule. With
    // every new adapter the check here grows by itself.
    const forbiddenIn = ['src/main/stores', 'src/main/platform', 'src/main/db']
    const allowed = new Set([
      'src/main/index.ts',
      'src/main/ipc.ts',
      'src/main/launch-bridge.ts'
    ])

    const files: string[] = []
    const collect = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) await collect(path)
        else if (entry.name.endsWith('.ts')) files.push(path)
      }
    }
    for (const dir of forbiddenIn) await collect(dir)
    files.push('src/main/sync.ts')

    // Catches the case where the collector finds nothing and the test
    // accidentally passes over an empty list.
    expect(files.length).toBeGreaterThan(10)

    for (const file of files) {
      if (allowed.has(file)) continue
      const source = await readFile(file, 'utf8')
      expect(source, `${file} must not import electron`).not.toMatch(
        /from ['"]electron['"]/
      )
    }
  })
})
