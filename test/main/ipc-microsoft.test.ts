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

/**
 * Lets every pending continuation run.
 *
 * A real timer rather than a microtask flush: the completion path awaits a
 * rescan, so the assertions after it need more than one turn of the queue,
 * and asserting on "nothing happened" needs the queue to have emptied
 * rather than merely advanced.
 */
const settle = async (): Promise<void> =>
  await new Promise((done) => setTimeout(done, 20))

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

  /**
   * Closing the configuration dialog clears the code from the screen but
   * not the poll from this process, so reopening it and clicking Sign in is
   * an ordinary thing to do. It used to start a second device code and a
   * second poll loop alongside the first, each triggering a full five-store
   * rescan when it succeeded — and `cancelled` was declared, checked inside
   * pollForTokens, and never supplied by anything, so neither loop could be
   * stopped.
   */
  it('cancels the poll already running rather than racing a second one against it', async () => {
    const cancellations: Array<() => boolean> = []
    build({
      pollForTokens: async (_code: unknown, cancelled: () => boolean) => {
        cancellations.push(cancelled)
        // Never settles: a real poll is still waiting on the browser.
        return new Promise<never>(() => undefined)
      }
    })

    await invoke(IPC.microsoftSignIn)
    expect(cancellations[0]?.()).toBe(false)

    await invoke(IPC.microsoftSignIn)

    expect(cancellations).toHaveLength(2)
    // The first poll is told to stop; the second one carries on.
    expect(cancellations[0]?.()).toBe(true)
    expect(cancellations[1]?.()).toBe(false)
  })

  /**
   * The double click this guards against: two invocations that both start
   * before either has heard back from Microsoft, so neither can see the
   * other's flow by checking `signInFlow` at the top the way a purely
   * sequential pair of calls would.
   *
   * `requestDeviceCode` is held open on hand-resolved promises rather than
   * awaited normally, so both invocations are genuinely in flight — still
   * inside their own `await microsoft.requestDeviceCode()` — at the moment
   * the second one starts. A sequential `await invoke(); await invoke()`
   * would let the first call finish registering its flow before the second
   * began, which is precisely the case the old guard already handled.
   *
   * `pollForTokens` reports its own device code back in the error message so
   * the two flows can be told apart once both eventually "expire": it checks
   * `cancelled()` once, exactly where the real implementation checks it at
   * the top of its loop, before ever reporting an expiry.
   *
   * Against the code before this fix, the guard clears and reads
   * `signInFlow` before either invocation has registered a replacement, so
   * both find it `undefined` and neither marks the other cancelled or
   * superseded. The first flow's poll then never notices anything happened
   * and its eventual "expired" answer reaches the screen as a genuine error,
   * clearing whatever code the second flow already put there. Registering
   * the new flow before the `await` (this fix) closes that window: the
   * second invocation now finds the first flow still in the slot and
   * supersedes it before either has a device code, so the first flow's
   * later expiry is caught and silenced instead of reported.
   */
  it('supersedes a flow that is still requesting its device code, and keeps the older one silent', async () => {
    let resolveFirst: ((code: typeof CODE) => void) | undefined
    let resolveSecond: ((code: typeof CODE) => void) | undefined
    let calls = 0
    build({
      requestDeviceCode: async () => {
        calls += 1
        if (calls === 1) {
          return await new Promise<typeof CODE>((resolve) => {
            resolveFirst = resolve
          })
        }
        return await new Promise<typeof CODE>((resolve) => {
          resolveSecond = resolve
        })
      },
      pollForTokens: async (code: typeof CODE, cancelled: () => boolean) => {
        if (cancelled()) throw new Error('The sign-in was cancelled.')
        throw new Error(`expired:${code.userCode}`)
      }
    })

    const first = invoke(IPC.microsoftSignIn)
    const second = invoke(IPC.microsoftSignIn)

    // Both calls are genuinely concurrent: neither has a device code yet, so
    // neither has reached the point of registering its flow's replacement.
    expect(calls).toBe(2)

    resolveFirst?.({ ...CODE, userCode: 'FIRST' })
    resolveSecond?.({ ...CODE, userCode: 'SECOND' })

    await Promise.all([first, second])
    await settle()

    const expired = harness.sentWithArgs
      .filter((event) => event.channel === IPC.microsoftAuthChanged)
      .map((event) => event.args[0])
      .filter((arg): arg is string => typeof arg === 'string' && arg.startsWith('expired:'))

    // Only the newer flow may ever report its own expiry. The older one
    // must have been superseded before it got that far, not left to answer
    // for itself minutes later.
    expect(expired).toEqual(['expired:SECOND'])
  })

  it('says nothing to the screen when the flow it cancelled ends', async () => {
    // The newer code is already on screen. "The sign-in was cancelled"
    // arriving on top of it would clear the very code being typed.
    let endFirst: ((reason: Error) => void) | undefined
    build({
      pollForTokens: async (_code: unknown, cancelled: () => boolean) =>
        await new Promise<never>((_resolve, reject) => {
          if (cancelled()) return
          endFirst ??= reject
        })
    })

    await invoke(IPC.microsoftSignIn)
    await invoke(IPC.microsoftSignIn)
    const before = harness.sentWithArgs.filter((e) => e.channel === IPC.microsoftAuthChanged).length

    endFirst?.(new Error('The sign-in was cancelled.'))
    await settle()

    expect(
      harness.sentWithArgs.filter((e) => e.channel === IPC.microsoftAuthChanged)
    ).toHaveLength(before)
  })

  it('does not connect the account when the poll comes back after a sign-out', async () => {
    // The poll only notices a cancellation between requests, so it can
    // still answer with tokens for a flow that has been signed out from
    // under it. Connecting on the strength of that would undo the sign-out
    // moments after the user asked for it.
    let finishPoll: ((tokens: { accessToken: string; refreshToken: string }) => void) | undefined
    const poll = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
      finishPoll = resolve
    })
    build({ pollForTokens: async () => await poll })

    await invoke(IPC.microsoftSignIn)
    await invoke(IPC.microsoftSignOut)

    finishPoll?.({ accessToken: 'a', refreshToken: 'r' })
    await settle()

    expect(signIn).not.toHaveBeenCalled()
    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })
  })

  it('tells the screen why, when a sign-out ends a poll that nothing replaced', async () => {
    // Not superseded by a newer attempt, so its own reason is the truthful
    // thing to show — the string t().stores.microsoft.signInCancelled was
    // unreachable before anything supplied `cancelled` at all.
    build({
      pollForTokens: async (_code: unknown, cancelled: () => boolean) => {
        for (;;) {
          if (cancelled()) throw new Error('The sign-in was cancelled.')
          await new Promise((done) => setTimeout(done, 1))
        }
      }
    })

    await invoke(IPC.microsoftSignIn)
    await invoke(IPC.microsoftSignOut)

    await vi.waitFor(() =>
      expect(
        harness.sentWithArgs.some(
          (event) =>
            event.channel === IPC.microsoftAuthChanged &&
            event.args[0] === 'The sign-in was cancelled.'
        )
      ).toBe(true)
    )
  })

  it('answers signed-out where no Microsoft session was built at all', async () => {
    handlers.clear()
    registerIpcHandlers(makeHarness().context)

    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })
    expect(await invoke(IPC.microsoftSignIn)).toEqual({ ok: false, error: expect.any(String) })
  })
})
