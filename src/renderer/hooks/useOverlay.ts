import { useCallback, useRef, useState } from 'react'

/**
 * What is laid over the library.
 *
 * Exactly one at a time: a freebie is by definition not in the library, so
 * its card never opens a details page, and the two can share one slot.
 */
export type Overlay = { kind: 'detail'; key: string } | { kind: 'freebies' }

export interface OverlayControls {
  overlay: Overlay | undefined
  openDetail: (key: string) => void
  openFreebies: () => void
  /** Closes what is open, remembering it for forward. */
  close: () => void
  /**
   * Closes what is open without remembering it for forward.
   *
   * Forward exists to reopen what the *user* closed. A view-mode switch or a
   * vanished library entry closes the overlay too, but neither is something
   * the user asked to leave — resurrecting it on the next forward press
   * would drop them somewhere they never navigated to. Worse, for the
   * vanished-entry case the effect that calls this fires again on every
   * render while the key stays missing, so recording it would keep
   * overwriting whatever a real `back()` had stored, permanently.
   */
  dismiss: () => void
  /** Closes what is open, remembering it for forward. */
  back: () => void
  /** Reopens what back closed. Does nothing while something is open. */
  forward: () => void
}

export function useOverlay(): OverlayControls {
  const [overlay, setOverlay] = useState<Overlay | undefined>()
  /** A history exactly one step deep — the library, and one page over it. */
  const lastClosed = useRef<Overlay | undefined>(undefined)

  const close = useCallback((): void => {
    setOverlay((current) => {
      if (current !== undefined) lastClosed.current = current
      return undefined
    })
  }, [])

  const dismiss = useCallback((): void => {
    setOverlay(undefined)
  }, [])

  return {
    overlay,
    openDetail: useCallback((key: string) => setOverlay({ kind: 'detail', key }), []),
    openFreebies: useCallback(() => setOverlay({ kind: 'freebies' }), []),
    close,
    dismiss,
    back: close,
    forward: useCallback(
      () => setOverlay((current) => (current === undefined ? lastClosed.current : current)),
      []
    )
  }
}
