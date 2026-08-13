/**
 * The two freebies handlers that both have to keep the toolbar badge honest.
 *
 * `freebies:get` already refreshes behind its answer and forwards the event
 * itself when something changed. `freebies:refresh` — the forced refresh the
 * page's own Refresh button calls — used to return the fresh list without
 * telling anyone else. The page looked right because it updates from the
 * return value directly; the toolbar badge, which only ever updates on mount
 * or on `freebies:changed`, did not. This is the regression test for that
 * gap.
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
const { FreebieService } = await import('@main/freebies/service')

describe('IPC freebies channels', () => {
  let harness: Harness

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    await handlers.get(channel)!({}, ...args)

  beforeEach(() => {
    handlers.clear()
    harness = makeHarness()
    // A stub fetchFn so refresh() completes without hitting the network —
    // every source parser degrades an unshaped body to an empty list, so
    // this succeeds rather than failing, which is what makes the forced
    // refresh below actually reach the point of sending anything.
    harness.context.freebies = new FreebieService({
      repo: harness.context.freebiesRepo,
      settings: harness.settings,
      locale: () => ({ language: 'en', country: 'US' }),
      games: () => harness.repo.all(),
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) })
    })
    registerIpcHandlers(harness.context)
  })

  it('sends freebies:changed after a forced refresh from the page', async () => {
    await invoke(IPC.freebiesRefresh)
    expect(harness.sent).toContain(IPC.freebiesChanged)
  })

  it('does not loop: the reload the event triggers hits the TTL guard instead of refetching', async () => {
    await invoke(IPC.freebiesRefresh)
    harness.sent.length = 0

    // freebies:get kicks off its own background refresh without awaiting
    // it, so its `.then` runs on a later tick.
    await invoke(IPC.freebiesGet)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.sent).not.toContain(IPC.freebiesChanged)
  })
})
