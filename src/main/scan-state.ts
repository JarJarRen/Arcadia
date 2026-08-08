/**
 * Whether a library scan is running, and who to tell when that changes.
 *
 * It exists because a scan has two sources. The button in the toolbar starts
 * one and the renderer knows it did; the main process starts another the
 * moment the app opens, and the renderer has no way to know about that one at
 * all. On a first start the second is the only one there is, so the library
 * sat there reporting "No games found yet — Refresh starts the scan" for the
 * four seconds the scan was already taking, which reads as a broken app
 * rather than a busy one.
 *
 * A depth counter rather than a boolean: the two sources can overlap — a
 * Refresh click while the startup scan is still going is an obvious thing to
 * do when the library looks empty — and a boolean would report "finished" as
 * soon as the first of the two came back, clearing the indicator while the
 * other was still writing rows.
 */
export interface ScanState {
  /** Whether at least one scan is in flight. */
  isScanning: () => boolean
  /**
   * Runs a scan, reporting it as in flight for as long as it takes.
   *
   * The result and any rejection are passed straight through, so this can
   * wrap an existing call without changing what the caller sees.
   */
  track: <T>(run: () => Promise<T>) => Promise<T>
}

/**
 * `notify` is called only on the transitions — the first scan starting and
 * the last one finishing — not once per scan. A renderer that received
 * `false` from an inner scan while an outer one was still running would clear
 * the indicator too early, which is the bug the counter exists to prevent.
 */
export function createScanState(notify: (scanning: boolean) => void): ScanState {
  let depth = 0

  return {
    isScanning: () => depth > 0,
    track: async <T>(run: () => Promise<T>): Promise<T> => {
      if (++depth === 1) notify(true)
      try {
        return await run()
      } finally {
        // In a `finally` so a scan that throws — an unreachable store, a
        // locked database — still clears the indicator. Left set, it would
        // spin for the rest of the session.
        if (--depth === 0) notify(false)
      }
    }
  }
}
