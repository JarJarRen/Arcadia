import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game, StoreId } from '@shared/types'
import type { GuidedInstall, StoreAdapter } from '@main/stores/types'

const opened: string[] = []

vi.mock('electron', () => ({
  shell: {
    openExternal: async (uri: string) => {
      opened.push(uri)
    }
  }
}))

const { installGame, launchGame, cancelInstall } = await import('@main/launch-bridge')

function game(storeId: StoreId): Game {
  return {
    id: `${storeId}:1`,
    storeId,
    storeGameId: '1',
    name: 'Test game',
    installed: false,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }
}

function adapter(id: StoreId, overrides: Partial<StoreAdapter> = {}): StoreAdapter {
  return {
    id,
    displayName: id,
    isAvailable: async () => ({ available: true }),
    scanInstalled: async () => [],
    launchUri: () => `${id}://launch`,
    installUri: () => `${id}://install`,
    ...overrides
  }
}

describe('installGame', () => {
  beforeEach(() => {
    opened.length = 0
  })

  it('opens the install URI, not the launch URI', async () => {
    // Swapped, a game that is not installed would do nothing at all — no
    // error, no message.
    await installGame([adapter('steam')], game('steam'))
    expect(opened).toEqual(['steam://install'])
  })

  it('passes the adapter hint through', async () => {
    // EA cannot install from outside; without the hint the click would look
    // as though it had fizzled out.
    const result = await installGame(
      [adapter('ea', { installNotice: 'Only opened the library.' })],
      game('ea')
    )
    expect(result).toEqual({ ok: true, notice: 'Only opened the library.' })
  })

  it('leaves the field out when the adapter has nothing to say', async () => {
    expect(await installGame([adapter('steam')], game('steam'))).toEqual({ ok: true })
  })

  it('does not attach the hint to a launch', async () => {
    // The hint explains a quirk of installing. On a launch it would be
    // pointless and confusing.
    const result = await launchGame(
      [adapter('ea', { installNotice: 'Only opened the library.' })],
      game('ea')
    )
    expect(result).toEqual({ ok: true })
  })

  it('reports the install URI when opening fails', async () => {
    const broken = adapter('epic', {
      installUri: () => {
        throw new Error('no identifier')
      }
    })
    const result = await installGame([broken], game('epic'))

    expect(result.ok).toBe(false)
    // "Install", not "Launch" — the message goes to the user.
    expect(result.error).toMatch(/^Installing/)
    expect(opened).toEqual([])
  })

  it('reports a missing adapter instead of silently doing nothing', async () => {
    const result = await installGame([], game('ubisoft'))
    expect(result.ok).toBe(false)
    expect(opened).toEqual([])
  })
})

import type { AgentHandle, PlacedEvent } from '@main/platform/windows'

function plan(overrides: Partial<GuidedInstall> = {}): GuidedInstall {
  return {
    exe: 'C:\\Steam\\steam.exe',
    args: ['-silent', 'steam://install/1'],
    processNames: ['steam.exe'],
    ignoreTitles: ['Steam'],
    minHeight: 0,
    timeoutNotice: 'No dialog appeared.',
    ...overrides
  }
}

function guidedAdapter(overrides: Partial<GuidedInstall> = {}): StoreAdapter {
  return adapter('steam', { guidedInstall: async () => plan(overrides) })
}

const FRAME = {
  target: { x: 0, y: 0, width: 1000, height: 700 },
  owner: '4242'
}

/** An agent whose two answers the test decides up front. */
function fakeAgent(
  started: boolean,
  placed: PlacedEvent | undefined
): {
  assist: {
    frame: () => typeof FRAME
    run: () => AgentHandle
    setAlwaysOnTop: (value: boolean) => void
  }
  cancels: () => number
  /** Every setAlwaysOnTop call, in order — true/false as it was invoked. */
  onTopCalls: () => boolean[]
} {
  let cancels = 0
  const onTop: boolean[] = []
  return {
    assist: {
      frame: () => FRAME,
      run: () => ({
        started: Promise.resolve(started),
        startedDetail: Promise.resolve(undefined),
        placed: Promise.resolve(placed),
        finished: Promise.resolve(),
        cancel: () => {
          cancels += 1
        }
      }),
      setAlwaysOnTop: (value) => {
        onTop.push(value)
      }
    },
    cancels: () => cancels,
    onTopCalls: () => onTop
  }
}

describe('guided install', () => {
  beforeEach(() => {
    opened.length = 0
    cancelInstall()
  })

  it('does not touch the shell when the agent starts the store itself', async () => {
    const agent = fakeAgent(true, { ok: true, hwnd: 9 })
    const result = await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(result).toEqual({ ok: true })
    // The agent runs steam.exe. Opening the URI as well would start a
    // second install of the same game.
    expect(opened).toEqual([])
  })

  it('runs the URI itself when the agent never launched anything', async () => {
    // The dangerous case: the agent is what starts Steam, so without this
    // the click would do nothing whatsoever.
    const agent = fakeAgent(false, undefined)
    const result = await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(result).toEqual({ ok: true })
    expect(opened).toEqual(['steam://install'])
  })

  it('logs the spawn detail before falling back to the shell', async () => {
    // Console-only, and deliberately so — see the note at the top of
    // shared/i18n.ts. Untested, this line is worth exactly as much as no
    // detail at all.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await installGame([guidedAdapter()], game('steam'), {
      frame: () => FRAME,
      run: () => ({
        started: Promise.resolve(false),
        startedDetail: Promise.resolve('boom'),
        placed: Promise.resolve(undefined),
        finished: Promise.resolve(),
        cancel: () => {}
      }),
      setAlwaysOnTop: () => {}
    })

    expect(result).toEqual({ ok: true })
    expect(opened).toEqual(['steam://install'])
    expect(spy).toHaveBeenCalledWith('Window agent failed to start the store:', 'boom')
  })

  it('explains a dialog that never appeared', async () => {
    const agent = fakeAgent(true, { ok: false, reason: 'timeout' })
    const result = await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(result).toEqual({ ok: true, notice: 'No dialog appeared.' })
  })

  it('says nothing when the placement was merely refused', async () => {
    // Steam running elevated and Arcadia not. The install is fine and a
    // banner about window handles would be noise.
    const agent = fakeAgent(true, { ok: false, reason: 'denied' })
    const result = await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(result).toEqual({ ok: true })
  })

  it('logs a failed placement with its reason', async () => {
    // Console-only, same as the started:false case above — see the note at
    // the top of shared/i18n.ts. A denied placement and a wizard Steam
    // quietly moved back after a good one look identical from the outside,
    // so untested this line is worth exactly as much as no reason at all.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // restoreMocks only clears this between tests within the 'node' project
    // when it is set there directly — set at the config's top level, above
    // `projects`, it does not reach in, the same gap the config's own alias
    // comment already flags. Clearing by hand keeps this test honest either
    // way rather than depending on that being fixed.
    spy.mockClear()
    const agent = fakeAgent(true, { ok: false, reason: 'denied' })

    await installGame([guidedAdapter()], game('steam'), agent.assist)

    // The command is part of the line, not decoration: a timeout means no
    // window ever appeared, and the first question is then whether the store
    // was asked for the right thing at all.
    expect(spy).toHaveBeenCalledWith(
      'Window agent failed to place the install wizard:',
      'denied',
      '- ran:',
      'C:\\Steam\\steam.exe',
      '-silent steam://install/1'
    )
  })

  it('logs nothing when the placement succeeds', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    spy.mockClear()
    const agent = fakeAgent(true, { ok: true, hwnd: 9 })

    await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(spy).not.toHaveBeenCalled()
  })

  it('says nothing when the agent died after starting the store', async () => {
    const agent = fakeAgent(true, undefined)
    expect(await installGame([guidedAdapter()], game('steam'), agent.assist)).toEqual({ ok: true })
  })

  it('falls back to the shell when the window is unknown', async () => {
    // No frame means no window to centre on — a minimised or destroyed
    // Arcadia. The install must still happen.
    const result = await installGame([guidedAdapter()], game('steam'), {
      frame: () => undefined,
      run: () => {
        throw new Error('must not run the agent without a frame')
      },
      setAlwaysOnTop: () => {
        throw new Error('must not touch always-on-top without a frame')
      }
    })

    expect(result).toEqual({ ok: true })
    expect(opened).toEqual(['steam://install'])
  })

  it('takes the plain route when no assist is offered at all', async () => {
    const result = await installGame([guidedAdapter()], game('steam'))

    expect(result).toEqual({ ok: true })
    expect(opened).toEqual(['steam://install'])
  })

  it('takes the plain route for an adapter with no guided route', async () => {
    const agent = fakeAgent(true, { ok: true })
    const result = await installGame([adapter('epic')], game('epic'), agent.assist)

    expect(result).toEqual({ ok: true })
    expect(opened).toEqual(['epic://install'])
    // The plain shell.openExternal route must not touch always-on-top at
    // all — only the guided path, which this adapter never enters, does.
    expect(agent.onTopCalls()).toEqual([])
  })

  it('reports a bad game ID without starting an agent', async () => {
    const broken = adapter('steam', {
      installUri: () => {
        throw new Error('no identifier')
      },
      guidedInstall: async () => plan()
    })
    const result = await installGame([broken], game('steam'), {
      frame: () => FRAME,
      run: () => {
        throw new Error('must not run the agent for an invalid ID')
      },
      setAlwaysOnTop: () => {
        throw new Error('must not touch always-on-top for an invalid ID')
      }
    })

    expect(result.ok).toBe(false)
    expect(opened).toEqual([])
  })

  it('cancels the agent on request', async () => {
    const agent = fakeAgent(true, { ok: true })
    let cancelled = 0
    const handle: AgentHandle = {
      started: Promise.resolve(true),
      startedDetail: Promise.resolve(undefined),
      // Never settles, so the agent is still current when cancel arrives.
      placed: new Promise(() => {}),
      finished: new Promise(() => {}),
      cancel: () => {
        cancelled += 1
      }
    }
    void installGame([guidedAdapter()], game('steam'), {
      frame: agent.assist.frame,
      run: () => handle,
      setAlwaysOnTop: agent.assist.setAlwaysOnTop
    })
    // Let the bridge get as far as awaiting the placement.
    await Promise.resolve()
    await Promise.resolve()

    cancelInstall()

    expect(cancelled).toBe(1)
  })

  it('does not resolve while the agent is still finishing, only once it does', async () => {
    // The important regression test: without `await handle.finished` in
    // guided(), this would resolve the instant `placed` does — exactly the
    // bug being fixed. The overlay's lifetime is this promise's lifetime, so
    // it has to stay pending for as long as the agent — and therefore the
    // wizard — is still open.
    let resolveFinished: (() => void) | undefined
    const handle: AgentHandle = {
      started: Promise.resolve(true),
      startedDetail: Promise.resolve(undefined),
      placed: Promise.resolve({ ok: true, hwnd: 9 }),
      finished: new Promise((resolve) => {
        resolveFinished = resolve
      }),
      cancel: () => {}
    }

    let settled = false
    const install = installGame([guidedAdapter()], game('steam'), {
      frame: () => FRAME,
      run: () => handle,
      setAlwaysOnTop: () => {}
    })
    void install.then(() => {
      settled = true
    })

    // A real timer rather than another microtask: it only fires once every
    // microtask already queued between here and `handle.finished` has
    // drained, however many that is. Nothing else can move this promise
    // forward, so if it has settled by the time this fires, the await on
    // `finished` is missing.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    resolveFinished?.()

    expect(await install).toEqual({ ok: true })
    expect(settled).toBe(true)
  })

  it('can still be cancelled while only waiting on the agent to finish', async () => {
    // The regression the `current` bookkeeping move could cause: if
    // `current` were cleared as soon as `placed` resolves rather than after
    // `finished` does, cancelInstall() — which Escape and a backdrop press
    // on the overlay both call — would find no agent left to cancel while
    // the wizard is still open.
    let cancelled = 0
    const handle: AgentHandle = {
      started: Promise.resolve(true),
      startedDetail: Promise.resolve(undefined),
      placed: Promise.resolve({ ok: true, hwnd: 9 }),
      finished: new Promise(() => {}),
      cancel: () => {
        cancelled += 1
      }
    }

    void installGame([guidedAdapter()], game('steam'), {
      frame: () => FRAME,
      run: () => handle,
      setAlwaysOnTop: () => {}
    })

    // Let the bridge get past `placed` and into awaiting `finished`.
    await new Promise((resolve) => setTimeout(resolve, 0))

    cancelInstall()

    expect(cancelled).toBe(1)
  })

  it('cancelling with no install running does nothing', () => {
    expect(() => cancelInstall()).not.toThrow()
  })
})

describe('always-on-top', () => {
  beforeEach(() => {
    opened.length = 0
    cancelInstall()
  })

  it('is set before the agent runs and cleared once it finishes, in that order', async () => {
    const events: string[] = []
    let resolveFinished: (() => void) | undefined
    const handle: AgentHandle = {
      started: Promise.resolve(true),
      startedDetail: Promise.resolve(undefined),
      placed: Promise.resolve({ ok: true, hwnd: 9 }),
      finished: new Promise((resolve) => {
        resolveFinished = resolve
      }),
      cancel: () => {}
    }

    const install = installGame([guidedAdapter()], game('steam'), {
      frame: () => FRAME,
      run: () => {
        events.push('run')
        return handle
      },
      setAlwaysOnTop: (value: boolean) => {
        events.push(value ? 'on' : 'off')
      }
    })

    // Let the bridge get as far as awaiting `finished` — everything up to
    // and including starting the agent must have already happened by now.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['on', 'run'])

    resolveFinished?.()
    await install

    expect(events).toEqual(['on', 'run', 'off'])
  })

  it('is cleared on the started:false fallback path', async () => {
    const agent = fakeAgent(false, undefined)
    await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(agent.onTopCalls()).toEqual([true, false])
  })

  it('is cleared when the agent reports a timeout', async () => {
    const agent = fakeAgent(true, { ok: false, reason: 'timeout' })
    await installGame([guidedAdapter()], game('steam'), agent.assist)

    expect(agent.onTopCalls()).toEqual([true, false])
  })

  it('is cleared even when the agent throws', async () => {
    // Proves the finally actually holds: a plain call on the success path
    // only would miss this entirely, and Arcadia would be stuck
    // always-on-top for good.
    const onTop: boolean[] = []

    await expect(
      installGame([guidedAdapter()], game('steam'), {
        frame: () => FRAME,
        run: () => {
          throw new Error('boom')
        },
        setAlwaysOnTop: (value: boolean) => {
          onTop.push(value)
        }
      })
    ).rejects.toThrow('boom')

    expect(onTop).toEqual([true, false])
  })
})
