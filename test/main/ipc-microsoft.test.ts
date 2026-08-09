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

  it('reports a device code that could not be requested', async () => {
    build({
      requestDeviceCode: async () => {
        throw new Error('invalid_client')
      }
    })

    expect(await invoke(IPC.microsoftSignIn)).toEqual({ ok: false, error: 'invalid_client' })
  })

  it('announces a sign-in that failed while polling', async () => {
    build({
      pollForTokens: async () => {
        throw new Error('expired')
      }
    })

    await invoke(IPC.microsoftSignIn)
    await vi.waitFor(() => expect(harness.sent).toContain(IPC.microsoftAuthChanged))
    expect(await invoke(IPC.microsoftAuthState)).toEqual({ signedIn: false })
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
