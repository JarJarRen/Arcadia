import { describe, expect, it } from 'vitest'
import { eaLauncherLogDir, parseLauncherTitles } from '@main/stores/ea/launcherLog'

describe('parseLauncherTitles', () => {
  it('reads the title EA writes into its own launch URI', () => {
    // Verbatim from EALauncher.log on the development machine. This is the
    // only local place a content id is paired with a readable name.
    const log =
      'Command line: [C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\' +
      'EALauncher.exe origin2://game/launch/?offerIds=198235&title=EA%u0020SPORTS%u0020FC%u002024' +
      '&authCode=&cmdParams=]'

    expect(parseLauncherTitles(log).get('198235')).toBe('EA SPORTS FC 24')
  })

  it('decodes ordinary percent escapes too', () => {
    const log = 'offerIds=123&title=Mass%20Effect%3A%20Andromeda&authCode='
    expect(parseLauncherTitles(log).get('123')).toBe('Mass Effect: Andromeda')
  })

  it('discards EA’s own placeholder for a missing name', () => {
    // EA hit the same gap in 2023 and wrote the complaint into the title
    // field. Taken literally, the library would show a game called
    // "DisplayName field missing from registry".
    const log =
      'offerIds=16115019&title=DisplayName%u0020field%u0020missing%u0020from%u0020registry&authCode='
    expect(parseLauncherTitles(log).has('16115019')).toBe(false)
  })

  it('keeps the newest title when a game was launched more than once', () => {
    // Games get renamed between seasons; the later launch is the better
    // name.
    const log = ['offerIds=1&title=FIFA%2023', 'offerIds=1&title=EA%20SPORTS%20FC%2024'].join('\n')
    expect(parseLauncherTitles(log).get('1')).toBe('EA SPORTS FC 24')
  })

  it('ignores lines without a title', () => {
    expect(parseLauncherTitles('offerIds=555&authCode=').size).toBe(0)
  })

  it('returns nothing for an empty or unrelated log', () => {
    expect(parseLauncherTitles('').size).toBe(0)
    expect(parseLauncherTitles('nothing to see here').size).toBe(0)
  })

  it('survives a title that cannot be decoded', () => {
    // A stray percent makes decodeURIComponent throw. Losing one name is
    // acceptable; losing the whole scan is not.
    const log = 'offerIds=7&title=100%%20Broken&authCode='
    expect(() => parseLauncherTitles(log)).not.toThrow()
  })
})

describe('eaLauncherLogDir', () => {
  it('follows LOCALAPPDATA rather than assuming a drive', () => {
    const dir = eaLauncherLogDir({ LOCALAPPDATA: 'D:\\Users\\x\\AppData\\Local' })
    expect(dir).toBe('D:\\Users\\x\\AppData\\Local\\Electronic Arts\\EA Desktop\\Logs')
  })
})
