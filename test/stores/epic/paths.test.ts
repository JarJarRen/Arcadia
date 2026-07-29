import { describe, expect, it } from 'vitest'
import {
  epicCatalogFile,
  epicDataDir,
  epicManifestDir,
  programDataDir
} from '@main/stores/epic/paths'

describe('programDataDir', () => {
  it('takes PROGRAMDATA when Windows has set it', () => {
    // The actual purpose: with Windows on a different drive, the path that
    // used to be hard-wired here pointed nowhere — and Epic would be
    // undiscoverable without anything looking like an error.
    expect(programDataDir({ PROGRAMDATA: 'D:\\ProgramData' })).toBe('D:\\ProgramData')
  })

  it('falls back to C:\\ProgramData when the variable is missing', () => {
    // The guess still beats nothing.
    expect(programDataDir({})).toBe('C:\\ProgramData')
  })

  it('treats an empty variable like a missing one', () => {
    // An empty value would otherwise yield the path "\Epic\…" — with no
    // drive, and therefore relative to the current directory.
    expect(programDataDir({ PROGRAMDATA: '' })).toBe('C:\\ProgramData')
  })
})

describe('Epic paths', () => {
  const env = { PROGRAMDATA: 'D:\\ProgramData' }

  it('derives the data directory from PROGRAMDATA', () => {
    expect(epicDataDir(env)).toBe('D:\\ProgramData\\Epic\\EpicGamesLauncher\\Data')
  })

  it('derives the manifest and catalogue paths from it', () => {
    expect(epicManifestDir(env)).toBe(
      'D:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'
    )
    expect(epicCatalogFile(env)).toBe(
      'D:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Catalog\\catcache.bin'
    )
  })

  it('uses Windows separators even when the test runs on Linux', () => {
    // `win32.join` rather than the ambient `join`: the latter follows the
    // running operating system and would produce "C:\ProgramData/Epic/…"
    // with mixed separators on Linux. This branch would then no longer be
    // testable there — the same reason as for the Steam paths.
    expect(epicCatalogFile(env)).not.toContain('/')
  })

  it('keeps the supplied path without mangling it', () => {
    // A path with a trailing separator must not produce a doubled one.
    expect(epicDataDir({ PROGRAMDATA: 'C:\\ProgramData\\' })).toBe(
      'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data'
    )
  })
})
