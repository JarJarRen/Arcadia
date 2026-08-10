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
  close: () => void
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

  return {
    overlay,
    openDetail: useCallback((key: string) => setOverlay({ kind: 'detail', key }), []),
    openFreebies: useCallback(() => setOverlay({ kind: 'freebies' }), []),
    close,
    back: close,
    forward: useCallback(
      () => setOverlay((current) => (current === undefined ? lastClosed.current : current)),
      []
    )
  }
}
