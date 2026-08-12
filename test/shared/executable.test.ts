import { describe, expect, it } from 'vitest'
import {
  defaultNameFor,
  executableProblem,
  folderOf,
  isShortcut,
  parseArguments
} from '@shared/executable'

describe('executableProblem', () => {
  it('accepts a Windows program', () => {
    expect(executableProblem('C:\\Games\\mc.exe', 'win32')).toBeUndefined()
  })

  it('rejects a relative path', () => {
    // A relative path would be resolved against whatever directory Arcadia
    // happened to be started from.
    expect(executableProblem('games\\mc.exe', 'win32')).toBe('notAbsolute')
  })

  it('rejects a batch file', () => {
    // .bat and .cmd need a shell interpreter, and routing a user-supplied
    // path through a shell is exactly what the argument array avoids.
    expect(executableProblem('C:\\Games\\run.bat', 'win32')).toBe('unsupportedType')
    expect(executableProblem('C:\\Games\\run.cmd', 'win32')).toBe('unsupportedType')
  })

  it('rejects an unresolved shortcut', () => {
    // spawn cannot run one; it must be resolved to its target first.
    expect(executableProblem('C:\\Users\\me\\mc.lnk', 'win32')).toBe('unsupportedType')
  })

  it('applies no extension rule away from Windows', () => {
    expect(executableProblem('/opt/mc/launcher', 'linux')).toBeUndefined()
  })
})

describe('parseArguments', () => {
  it('splits on spaces', () => {
    expect(parseArguments('--offline --debug')).toEqual(['--offline', '--debug'])
  })

  it('keeps a quoted value together', () => {
    expect(parseArguments('--profile "My Pack"')).toEqual(['--profile', 'My Pack'])
  })

  it('is empty for empty input', () => {
    expect(parseArguments('   ')).toEqual([])
  })

  it('does not interpret shell characters', () => {
    // The whole point: this reaches spawn as one argument, not as a command.
    expect(parseArguments('--name a&b')).toEqual(['--name', 'a&b'])
  })
})

describe('defaultNameFor', () => {
  it('is the file name without its extension', () => {
    expect(defaultNameFor('C:\\Games\\Minecraft Launcher.exe')).toBe('Minecraft Launcher')
    expect(defaultNameFor('/opt/mc/launcher')).toBe('launcher')
  })
})

describe('isShortcut', () => {
  it('recognises a .lnk regardless of case', () => {
    expect(isShortcut('C:\\a\\b.LNK')).toBe(true)
    expect(isShortcut('C:\\a\\b.exe')).toBe(false)
  })
})

describe('folderOf', () => {
  it('answers for the path it is given, not for the host', () => {
    // This is the whole reason the module exists: node:path's default
    // export answers `.` for a Windows path on the Linux box that runs CI.
    expect(folderOf('C:\\Games\\mc.exe')).toBe('C:\\Games')
    expect(folderOf('/opt/mc/launcher')).toBe('/opt/mc')
  })

  it('keeps the root when the file sits in it', () => {
    expect(folderOf('C:\\mc.exe')).toBe('C:\\')
    expect(folderOf('/launcher')).toBe('/')
  })
})
