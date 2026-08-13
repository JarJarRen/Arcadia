import { useEffect, useId, useRef, useState, type ReactElement } from 'react'

interface Props {
  /** Accessible name for the trigger, e.g. "Details about EA". */
  label: string
  /**
   * The lines to reveal, one entry each.
   *
   * Empty means the component renders nothing at all, so a caller with
   * nothing to explain needs no guard of its own — and no affordance
   * appears for a reader to go hunting through.
   */
  items: string[]
}

/**
 * An "i" that reveals a few lines of explanation.
 *
 * A **disclosure**, not a dialog: it shows static text, traps no focus and
 * makes nothing behind it inert. Saying so in the markup — `aria-expanded`
 * on a button, a plain panel — is more honest than borrowing dialog
 * semantics it does not enforce.
 *
 * Focus moves into the panel when it opens, which is what a native `title`
 * tooltip cannot do and the reason this exists at all: the detail has to be
 * reachable without a mouse.
 */
export function InfoPopover({ label, items }: Props): ReactElement | null {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    // Optional call: the panel is absolutely positioned inside a dialog that
    // scrolls at 80vh, so one opened near the bottom would otherwise be
    // clipped. jsdom implements no scrollIntoView at all, and calling it
    // unguarded would throw in every test that opens the panel.
    panel.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])

  useEffect(() => {
    if (!open) return

    /**
     * Deliberately not `useDismiss`, and this is the whole reason.
     *
     * That hook also closes on Escape, from a listener on `document`, and
     * `SetupDialog` closes the configuration screen from one on `window`.
     * Both sit above this panel in the bubble path, so both would fire and
     * dismissing this panel would take the screen with it — and between two
     * listeners on the same target, `stopPropagation` cannot decide which
     * wins. Escape is handled on the panel element instead, below both of
     * them, where stopping it genuinely prevents either from seeing the key.
     * Only the outside-press half lives here, and that collides with nothing.
     *
     * `mousedown` rather than `click`, matching useDismiss: the panel must
     * be gone before whatever sits underneath it reacts.
     */
    const onPointerDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // After the hooks, never before: hooks must not be called conditionally.
  if (items.length === 0) return null

  return (
    <span className="popover" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="button button--info"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        i
      </button>

      {open && (
        <div
          id={panelId}
          ref={panel}
          // A div is not focusable without this, and the Escape handler below
          // only ever runs on a focused element.
          tabIndex={-1}
          className="popover__panel popover__panel--info"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setOpen(false)
            trigger.current?.focus()
          }}
        >
          <ul className="popover__notes">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}
