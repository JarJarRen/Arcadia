import { describe, expect, it } from 'vitest'
import { createGapScheduler } from '@main/metadata/gapScheduler'

/**
 * Collects the callbacks a scheduler asks for so a test can fire them.
 *
 * A real timer would make these tests wait, and waiting tests get short
 * delays, and short delays are what makes a coalescing test flaky.
 */
function timers() {
  const queue: Array<{ fn: () => void; ms: number }> = []
  return {
    schedule: (fn: () => void, ms: number) => queue.push({ fn, ms }),
    pending: () => queue.length,
    delays: () => queue.map((t) => t.ms),
    /** Fires everything currently queued, in order. */
    fire: () => {
      const due = queue.splice(0, queue.length)
      for (const t of due) t.fn()
    }
  }
}

/** A promise whose resolution the test controls. */
function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('the artwork gap scheduler', () => {
  it('runs the pass once after a request', async () => {
    const clock = timers()
    let runs = 0
    const scheduler = createGapScheduler({
      run: async () => {
        runs++
      },
      delayMs: 2000,
      schedule: clock.schedule
    })

    scheduler.request()
    expect(runs).toBe(0) // not before the delay

    clock.fire()
    await scheduler.idle()

    expect(runs).toBe(1)
  })

  it('coalesces a burst into a single pass', async () => {
    // The real burst: the renderer reports every broken tile it paints, and
    // 13 of them arrive within a few hundred milliseconds. Thirteen passes
    // over the whole gap list would be pointless work.
    const clock = timers()
    let runs = 0
    const scheduler = createGapScheduler({
      run: async () => {
        runs++
      },
      delayMs: 2000,
      schedule: clock.schedule
    })

    for (let i = 0; i < 13; i++) scheduler.request()
    expect(clock.pending()).toBe(1)

    clock.fire()
    await scheduler.idle()

    expect(runs).toBe(1)
  })

  it('runs again for a request that arrives mid-pass', async () => {
    // Not merely nice to have: the pass reads its work list once at the
    // start, so a gap opened after that is invisible to it. Dropping the
    // request would leave that game without a picture until a restart —
    // which is the defect this whole scheduler exists to close.
    const clock = timers()
    const first = deferred()
    let runs = 0
    const scheduler = createGapScheduler({
      run: async () => {
        runs++
        if (runs === 1) await first.promise
      },
      delayMs: 2000,
      schedule: clock.schedule
    })

    scheduler.request()
    clock.fire()
    expect(runs).toBe(1)

    scheduler.request()
    expect(runs).toBe(1) // still the first pass, no overlap

    first.resolve()
    await scheduler.idle()
    clock.fire()
    await scheduler.idle()

    expect(runs).toBe(2)
  })

  it('never runs two passes at once', async () => {
    const clock = timers()
    const gate = deferred()
    let active = 0
    let overlapped = false
    const scheduler = createGapScheduler({
      run: async () => {
        active++
        if (active > 1) overlapped = true
        await gate.promise
        active--
      },
      delayMs: 2000,
      schedule: clock.schedule
    })

    scheduler.request()
    clock.fire()
    scheduler.request()
    clock.fire()
    gate.resolve()
    await scheduler.idle()

    expect(overlapped).toBe(false)
  })

  it('keeps working after a pass throws', async () => {
    // SteamGridDB being unreachable must not wedge the scheduler for the
    // rest of the session.
    const clock = timers()
    let runs = 0
    const scheduler = createGapScheduler({
      run: async () => {
        runs++
        if (runs === 1) throw new Error('SteamGridDB unreachable')
      },
      delayMs: 2000,
      schedule: clock.schedule,
      // Swallowed rather than logged, so the test output stays clean. The
      // default reports to the console.
      onError: () => undefined
    })

    scheduler.request()
    clock.fire()
    await scheduler.idle()

    scheduler.request()
    clock.fire()
    await scheduler.idle()

    expect(runs).toBe(2)
  })

  it('waits the configured delay', async () => {
    const clock = timers()
    const scheduler = createGapScheduler({
      run: async () => undefined,
      delayMs: 2000,
      schedule: clock.schedule
    })

    scheduler.request()

    expect(clock.delays()).toEqual([2000])
  })
})
