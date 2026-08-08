/**
 * The record of whether a scan is running.
 *
 * Worth its own file because the case that matters is an overlap, and an
 * overlap is awkward to reach through the IPC handlers: the startup scan is
 * begun by `main/index.ts`, which needs a live Electron to run at all. Here
 * the two scans can simply be held open by hand.
 */
import { describe, expect, it } from 'vitest'
import { createScanState } from '@main/scan-state'

/** A promise plus the handle to settle it, so a scan can be held open. */
function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createScanState', () => {
  it('reports nothing running before the first scan', () => {
    const state = createScanState(() => undefined)
    expect(state.isScanning()).toBe(false)
  })

  it('announces the start and the end exactly once each', async () => {
    const seen: boolean[] = []
    const state = createScanState((scanning) => seen.push(scanning))

    await state.track(async () => undefined)

    expect(seen).toEqual([true, false])
  })

  it('passes the result through', async () => {
    const state = createScanState(() => undefined)
    await expect(state.track(async () => 42)).resolves.toBe(42)
  })

  it('reports a scan as running for as long as it takes', async () => {
    const state = createScanState(() => undefined)
    const scan = deferred()

    const tracked = state.track(() => scan.promise)
    expect(state.isScanning()).toBe(true)

    scan.resolve()
    await tracked
    expect(state.isScanning()).toBe(false)
  })

  /**
   * The reason this is a counter and not a boolean. Someone looking at an
   * empty library during the startup scan will press Refresh, which is
   * exactly when a boolean would go wrong: the inner scan finishing would
   * report "done" while the outer one was still writing rows.
   */
  it('stays running until the last of two overlapping scans ends', async () => {
    const seen: boolean[] = []
    const state = createScanState((scanning) => seen.push(scanning))
    const startup = deferred()
    const refresh = deferred()

    const first = state.track(() => startup.promise)
    const second = state.track(() => refresh.promise)
    expect(seen).toEqual([true])

    refresh.resolve()
    await second
    expect(state.isScanning()).toBe(true)
    expect(seen).toEqual([true])

    startup.resolve()
    await first
    expect(state.isScanning()).toBe(false)
    expect(seen).toEqual([true, false])
  })

  /**
   * A store on a disconnected drive, a locked database. Left set by a throw,
   * the indicator would spin for the rest of the session and Refresh would
   * look permanently busy.
   */
  it('clears the flag when a scan throws, and rethrows', async () => {
    const seen: boolean[] = []
    const state = createScanState((scanning) => seen.push(scanning))

    await expect(
      state.track(() => Promise.reject(new Error('Steam is unreachable.')))
    ).rejects.toThrow('Steam is unreachable.')

    expect(state.isScanning()).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('survives a failed scan overlapping a successful one', async () => {
    const state = createScanState(() => undefined)
    const failing = deferred()
    const working = deferred()

    const first = state.track(() => failing.promise)
    const second = state.track(() => working.promise)

    failing.reject(new Error('nope'))
    await expect(first).rejects.toThrow('nope')
    expect(state.isScanning()).toBe(true)

    working.resolve()
    await second
    expect(state.isScanning()).toBe(false)
  })
})
