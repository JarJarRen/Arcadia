/**
 * Re-runs the artwork pass when a gap appears after the pass has finished.
 *
 * The gaps this closes are the ones the app opens itself. `runMetadataService`
 * runs once at startup; the renderer then reports every image that fails to
 * load, and the handler discards those rows so the next pass can replace
 * them. Without a second pass "next" means the next start of the app —
 * measured on a real library: eight games sat with no picture at all while
 * SteamGridDB had one for each.
 *
 * Two properties matter, and both come from how a pass works. It reads its
 * work list once at the beginning, so a gap opened afterwards is invisible
 * to the run in flight and needs another one. And it walks the whole list
 * with a pause between requests, so two of them at once would double the
 * request rate against an API that publishes no rate limit.
 */
export interface GapSchedulerDeps {
  run: () => Promise<void>
  /**
   * How long to wait before running.
   *
   * Not a throttle for its own sake: the renderer reports broken tiles as it
   * paints them, so they arrive in a burst. Waiting collects the burst into
   * one pass.
   */
  delayMs: number
  /** Injectable so tests need no real clock. */
  schedule?: (fn: () => void, ms: number) => void
  onError?: (error: unknown) => void
}

export interface GapScheduler {
  /** A gap has appeared. Runs a pass, eventually and at most once. */
  request: () => void
  /**
   * Resolves once no pass is in flight.
   *
   * The only way to observe a pass from outside — the scheduler reports
   * nothing else, on purpose: there is no caller that could act on the
   * result.
   */
  idle: () => Promise<void>
}

export function createGapScheduler(deps: GapSchedulerDeps): GapScheduler {
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      // Unreferenced would be wrong: a pending pass should keep the process
      // alive as much as any other pending work.
      setTimeout(fn, ms)
    })
  const onError = deps.onError ?? ((error: unknown) => console.error('Artwork pass failed:', error))

  let armed = false
  let running: Promise<void> | undefined
  let requestedDuringRun = false

  const start = (): void => {
    running = (async () => {
      try {
        await deps.run()
      } catch (error) {
        // A failed pass is not fatal and must not wedge the scheduler:
        // SteamGridDB being unreachable now says nothing about later.
        onError(error)
      } finally {
        running = undefined
        if (requestedDuringRun) {
          requestedDuringRun = false
          arm()
        }
      }
    })()
  }

  const arm = (): void => {
    if (armed) return
    armed = true
    schedule(() => {
      armed = false
      // Arrived while a pass was running after all — that pass may already
      // have walked past this gap, so wait for it and go again.
      if (running !== undefined) {
        requestedDuringRun = true
        return
      }
      start()
    }, deps.delayMs)
  }

  return {
    request: () => {
      if (running !== undefined) {
        requestedDuringRun = true
        return
      }
      arm()
    },
    idle: async () => {
      while (running !== undefined) await running
    }
  }
}
