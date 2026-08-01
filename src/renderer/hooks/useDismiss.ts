import { useEffect, type RefObject } from 'react'

/**
 * Closes an open popover on a click outside it or on Escape.
 *
 * Shared by the toolbar's two popovers rather than written twice. Without it
 * a panel stays open behind the next click, over the tiles — and the two
 * copies would inevitably drift apart, leaving one of them dismissible only
 * by clicking its own button again.
 *
 * `mousedown` rather than `click`: the popover must be gone before whatever
 * was clicked underneath it reacts.
 */
export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  close: () => void
): void {
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, root, close])
}
