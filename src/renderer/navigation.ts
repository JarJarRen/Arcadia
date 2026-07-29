/**
 * The mouse's thumb buttons, as a browser treats them.
 *
 * Chromium numbers them 3 (back) and 4 (forward). The named constants in
 * the DOM stop at 2, so the number is the only way to say it.
 *
 * The pair mirrors a browser: back closes the details page, forward reopens
 * the one just closed. That is a history exactly one step deep, which is
 * all this navigation has — there is the library, and there is one game on
 * top of it.
 */
export function isMouseBackButton(event: { button: number }): boolean {
  return event.button === 3
}

export function isMouseForwardButton(event: { button: number }): boolean {
  return event.button === 4
}
