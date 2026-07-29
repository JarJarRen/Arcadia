import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSteamLibraries } from '@main/stores/steam/manifests'

/**
 * These tests create real directories rather than mocking the file
 * system. `scanSteamLibraries` is almost entirely I/O error handling —
 * a mock would abstract away exactly the cases this is about.
 */
let root: string

const manifest = (appId: string, name: string, installDir: string, flags = '4'): string => `
"AppState"
{
	"appid"		"${appId}"
	"name"		"${name}"
	"StateFlags"		"${flags}"
	"installdir"		"${installDir}"
	"SizeOnDisk"		"1073741824"
}
`

async function createLibrary(
  libPath: string,
  manifests: Array<{ appId: string; name: string; installDir: string; flags?: string }>
): Promise<void> {
  const steamApps = join(libPath, 'steamapps')
  await mkdir(steamApps, { recursive: true })
  for (const m of manifests) {
    await writeFile(
      join(steamApps, `appmanifest_${m.appId}.acf`),
      manifest(m.appId, m.name, m.installDir, m.flags),
      'utf8'
    )
  }
}

async function libraryFolders(steamPath: string, paths: string[]): Promise<void> {
  const entries = paths
    .map((p, i) => `\t"${i}"\n\t{\n\t\t"path"\t\t"${p.replace(/\\/g, '\\\\')}"\n\t}`)
    .join('\n')
  await writeFile(
    join(steamPath, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n${entries}\n}\n`,
    'utf8'
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'arcadia-scan-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanSteamLibraries', () => {
  it('finds games in the main installation', async () => {
    const steam = join(root, 'steam')
    await createLibrary(steam, [
      { appId: '440', name: 'Team Fortress 2', installDir: 'TF2' }
    ])
    await libraryFolders(steam, [steam])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name)).toEqual(['Team Fortress 2'])
    expect(games[0]!.installPath).toBe(join(steam, 'steamapps', 'common', 'TF2'))
  })

  it('finds games across several libraries', async () => {
    // Das Zielsystem hat vier Bibliotheken auf vier Laufwerken — der
    // Normalfall, nicht der Sonderfall.
    const steam = join(root, 'steam')
    const second = join(root, 'lib2')
    const third = join(root, 'lib3')
    await createLibrary(steam, [{ appId: '1', name: 'Eins', installDir: 'Eins' }])
    await createLibrary(second, [{ appId: '2', name: 'Zwei', installDir: 'Zwei' }])
    await createLibrary(third, [{ appId: '3', name: 'Drei', installDir: 'Drei' }])
    await libraryFolders(steam, [steam, second, third])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name).sort()).toEqual(['Drei', 'Eins', 'Zwei'])
  })

  it('skips a library on a disconnected drive', async () => {
    // Without this tolerance the whole library would be invisible as soon
    // as an external disk is missing.
    const steam = join(root, 'steam')
    await createLibrary(steam, [{ appId: '1', name: 'Here', installDir: 'Here' }])
    await libraryFolders(steam, [steam, join(root, 'doesnotexist')])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name)).toEqual(['Here'])
  })

  it('skips a library folder without a steamapps directory', async () => {
    const steam = join(root, 'steam')
    const empty = join(root, 'empty')
    await mkdir(empty, { recursive: true })
    await createLibrary(steam, [{ appId: '1', name: 'Here', installDir: 'Here' }])
    await libraryFolders(steam, [steam, empty])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name)).toEqual(['Here'])
  })

  it('skips a broken manifest without losing the others', async () => {
    const steam = join(root, 'steam')
    await createLibrary(steam, [{ appId: '1', name: 'Heil', installDir: 'Heil' }])
    await writeFile(
      join(steam, 'steamapps', 'appmanifest_666.acf'),
      'complete nonsense {{{ "',
      'utf8'
    )
    await libraryFolders(steam, [steam])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name)).toEqual(['Heil'])
  })

  it('ignores files that are not manifests', async () => {
    const steam = join(root, 'steam')
    await createLibrary(steam, [{ appId: '1', name: 'Game', installDir: 'Game' }])
    await writeFile(join(steam, 'steamapps', 'workshop.vdf'), '"x" "y"', 'utf8')
    await writeFile(join(steam, 'steamapps', 'appmanifest_2.txt'), 'egal', 'utf8')
    await libraryFolders(steam, [steam])

    expect(await scanSteamLibraries(steam)).toHaveLength(1)
  })

  it('lets the installed copy win for a game in two libraries', async () => {
    // Happens when a game was moved and a leftover manifest stayed
    // behind. The incomplete copy must not displace the finished one.
    
    const steam = join(root, 'steam')
    const second = join(root, 'lib2')
    await createLibrary(steam, [
      { appId: '440', name: 'TF2', installDir: 'TF2', flags: '1026' }
    ])
    await createLibrary(second, [{ appId: '440', name: 'TF2', installDir: 'TF2' }])
    await libraryFolders(steam, [steam, second])

    const games = await scanSteamLibraries(steam)
    expect(games).toHaveLength(1)
    expect(games[0]!.installed).toBe(true)
    expect(games[0]!.installPath).toBe(join(second, 'steamapps', 'common', 'TF2'))
  })

  it('finds games even without libraryfolders.vdf', async () => {
    // Die Hauptinstallation muss immer durchsucht werden, auch wenn die
    // Bibliotheksliste fehlt oder unlesbar ist.
    const steam = join(root, 'steam')
    await createLibrary(steam, [{ appId: '1', name: 'Allein', installDir: 'Allein' }])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name)).toEqual(['Allein'])
  })

  it('filters non-games out during the full scan too', async () => {
    const steam = join(root, 'steam')
    await createLibrary(steam, [
      { appId: '440', name: 'Real Game', installDir: 'Real' },
      { appId: '228980', name: 'Steamworks Common Redistributables', installDir: 'Shared' },
      { appId: '99', name: 'Irgendwas SDK', installDir: 'SDK' }
    ])
    await libraryFolders(steam, [steam])

    const games = await scanSteamLibraries(steam)
    expect(games.map((g) => g.name)).toEqual(['Real Game'])
  })

  it('returns an empty list when the Steam path does not exist at all', async () => {
    expect(await scanSteamLibraries(join(root, 'nichts'))).toEqual([])
  })

  it('leaves an absolute installdir untouched', async () => {
    // Valve normally writes just a folder name here. If an absolute path
    // did arrive, blindly joining would produce nonsense with a drive
    // "C:\steamapps\common\D:\Elsewhere".
    const steam = join(root, 'steam')
    await createLibrary(steam, [
      { appId: '1', name: 'Absolute', installDir: 'D:\\\\Elsewhere\\\\Game' }
    ])
    await libraryFolders(steam, [steam])

    const games = await scanSteamLibraries(steam)
    expect(games[0]!.installPath).toBe('D:\\Elsewhere\\Game')
  })
})
