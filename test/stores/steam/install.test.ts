import { describe, expect, it } from 'vitest'
import { steamGuidedInstall } from '@main/stores/steam/install'

describe('steamGuidedInstall', () => {
  it('starts Steam silently with the install URI', () => {
    const plan = steamGuidedInstall('C:\\Program Files (x86)\\Steam', 'steam://install/440', 'win32')

    expect(plan?.exe).toBe('C:\\Program Files (x86)\\Steam\\steam.exe')
    // -silent keeps the client in the tray, which is the whole point; the
    // URI last, because steam.exe forwards it to a running instance and so
    // one command covers both the cold and the warm start.
    expect(plan?.args).toEqual(['-silent', 'steam://install/440'])
  })

  it('names both processes that own Steam windows', () => {
    // The modern client renders its dialogs out of the helper process, so
    // watching steam.exe alone would never see the wizard.
    const plan = steamGuidedInstall('C:\\Steam', 'steam://install/440', 'win32')
    expect(plan?.processNames).toEqual(['steam.exe', 'steamwebhelper.exe'])
  })

  it('never mistakes the main client window for the dialog', () => {
    const plan = steamGuidedInstall('C:\\Steam', 'steam://install/440', 'win32')
    expect(plan?.ignoreTitles).toEqual(['Steam'])
  })

  it('grows the wizard tall enough to reach the Install button', () => {
    // Measured by hand on the owner's machine: the wizard opens at 540x480
    // when launched via a steam://install/ URI, with the Install button
    // below the fold. 760 was confirmed reachable.
    const plan = steamGuidedInstall('C:\\Steam', 'steam://install/440', 'win32')
    expect(plan?.minHeight).toBe(760)
  })

  it('carries the explanation for a dialog that never appears', () => {
    const plan = steamGuidedInstall('C:\\Steam', 'steam://install/440', 'win32')
    expect(plan?.timeoutNotice).toBeTruthy()
    expect(plan?.timeoutNotice).toContain('Steam')
  })

  it('names the repeat-request refusal, which is the measured common cause', () => {
    // Measured on the development machine, and it accounted for nearly every
    // reported failure: once an install dialog has been opened and closed for
    // a game, Steam silently ignores further steam://install requests for
    // that same game for well over forty seconds. A different game works
    // instantly in the same second, so the refusal is per-game rather than a
    // global rate limit.
    //
    // Earlier wordings blamed a missing sign-in, then an unavailable game.
    // Both sent the user looking for something that was not wrong.
    const plan = steamGuidedInstall('C:\\Steam', 'steam://install/440', 'win32')
    expect(plan?.timeoutNotice).toMatch(/repeat request/i)
  })

  it('has no plan on Linux', () => {
    // There is no window agent there, and the plain URI is the whole of
    // the supported behaviour.
    expect(steamGuidedInstall('/home/x/.steam/steam', 'steam://install/440', 'linux')).toBeUndefined()
  })

  it('has no plan without a Steam path', () => {
    expect(steamGuidedInstall(undefined, 'steam://install/440', 'win32')).toBeUndefined()
    expect(steamGuidedInstall('', 'steam://install/440', 'win32')).toBeUndefined()
  })
})
