/**
 * The sign-in as the interface drives it.
 *
 * The device code is returned at once and the polling continues in the main
 * process: a handler that only answered when the user had finished in their
 * browser would leave the screen with nothing to show for a minute or more.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Harness } from './ipc-context'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  shell: { showItemInFolder: () => undefined, openExternal: async () => undefined }
}))

const { registerIpcHandlers } = await import('@main/ipc')
const { makeHarness } = await import('./ipc-context')
const { IPC } = await import('@shared/ipc')

const CODE = {
  deviceCode: 'dev',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://microsoft.com/link',
  intervalSeconds: 5
}

describe('IPC Microsoft sign-in', () => {
  let harness: Harness
  let signedIn: boolean
  let signIn: ReturnType<typeof vi.fn>

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  const build = (overrides: Record<string, unknown> = {}): void => {
    handlers.clear()
    signedIn = false
    signIn = vi.fn(() => {
      signedIn = true
    })
    harness = makeHarness({
      microsoft: {
        session: {
          isSignedIn: () => signedIn,
          gamertag: () => (signedIn ? 'Player' : undefined),
          signIn,
          signOut: () => {
            signedIn = false
          },
          tokens: async () => undefined
        },
        requestDeviceCode: async () => CODE,
        pollForTokens: async () => ({ accessToken: 'a', refreshToken: 'r' }),
        ...overrides
      } as never
    })
    registerIpcHandlers(harness.context)
  }

  beforeEach(() => build())

  it('reports being signed out', async () => {
    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })
  })

  it('returns the code and the link straight away', async () => {
    expect(await invoke(IPC.microsoftSignIn)).toEqual({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/link'
    })
  })

  /**
   * Pins the property the whole handler exists for: it must answer with the
   * device code the moment one exists, not once the browser sign-in has
   * finished. The test above resolves `pollForTokens` immediately, so it
   * cannot tell an `await`ed poll from a fire-and-forget one — both shapes
   * make it pass. This one holds the poll open with a promise the test
   * settles by hand, so the invoke can only resolve early if the handler
   * really does not wait on it.
   *
   * A short explicit timeout, rather than the suite's default: if this
   * regresses, the invoke hangs forever on the still-open poll promise, and
   * the failure should be fast rather than stalling the whole run.
   */
  it('answers with the device code while the poll is still outstanding, not after it settles', async () => {
    let resolvePoll: ((tokens: { accessToken: string; refreshToken: string }) => void) | undefined
    const poll = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
      resolvePoll = resolve
    })
    build({ pollForTokens: async () => poll })

    const result = await invoke(IPC.microsoftSignIn)

    expect(result).toEqual({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/link'
    })
    // The poll has deliberately not been resolved yet — reaching this line
    // at all is the proof the handler did not await it.
    expect(signIn).not.toHaveBeenCalled()

    // Now let the browser side of the sign-in finish, and check the
    // completion path still runs to the end.
    resolvePoll?.({ accessToken: 'a', refreshToken: 'r' })
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(harness.sent).toContain(IPC.microsoftAuthChanged)
  }, 1000)

  it('keeps the tokens once the browser sign-in finishes', async () => {
    await invoke(IPC.microsoftSignIn)
    // The polling runs on after the handler answered.
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled())

    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: true, gamertag: 'Player' })
    expect(harness.sent).toContain(IPC.microsoftAuthChanged)
  })

  it('rescans once the account is connected, so the owned games arrive', async () => {
    await invoke(IPC.microsoftSignIn)
    await vi.waitFor(() => expect(harness.sent).toContain(IPC.libraryChanged))
  })

  /**
   * MicrosoftSession.signIn() writes the token but does not itself learn the
   * gamertag — that only arrives from Xbox Live, through session.tokens(),
   * which the scan triggered by this very sign-in is what calls it. A single
   * notifyAuthChanged sent right after signIn() would have the renderer read
   * the auth state before that scan has had any chance to run, and it would
   * be stuck showing no gamertag until some unrelated later event. A second
   * notification once the rescan has gone through is what lets the renderer
   * pick up the name for real.
   */
  it('announces the auth change again after the rescan, so a gamertag learned only during it is not missed', async () => {
    await invoke(IPC.microsoftSignIn)
    await vi.waitFor(() => expect(harness.sent).toContain(IPC.libraryChanged))

    const authChangedCount = harness.sent.filter((c) => c === IPC.microsoftAuthChanged).length
    expect(authChangedCount).toBeGreaterThanOrEqual(2)
  })

  it('reports a device code that could not be requested', async () => {
    build({
      requestDeviceCode: async () => {
        throw new Error('invalid_client')
      }
    })

    expect(await invoke(IPC.microsoftSignIn)).toEqual({ ok: false, error: 'invalid_client' })
  })

  it('announces a sign-in that failed while polling, carrying the reason', async () => {
    build({
      pollForTokens: async () => {
        throw new Error('expired')
      }
    })

    await invoke(IPC.microsoftSignIn)
    await vi.waitFor(() => expect(harness.sent).toContain(IPC.microsoftAuthChanged))
    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })

    // The reason is not just logged and dropped — it rides along on the
    // event so the renderer can show the user why the sign-in did not
    // finish, instead of leaving a dead code on screen.
    const authChanged = harness.sentWithArgs.find((event) => event.channel === IPC.microsoftAuthChanged)
    expect(authChanged?.args).toEqual(['expired'])
  })

  it('signs out and rescans, so the owned games fall out again', async () => {
    await invoke(IPC.microsoftSignIn)
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled())

    await invoke(IPC.microsoftSignOut)

    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })
    expect(harness.sent).toContain(IPC.microsoftAuthChanged)
  })

  it('answers signed-out where no Microsoft session was built at all', async () => {
    handlers.clear()
    registerIpcHandlers(makeHarness().context)

    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })
    expect(await invoke(IPC.microsoftSignIn)).toEqual({ ok: false, error: expect.any(String) })
  })
})
