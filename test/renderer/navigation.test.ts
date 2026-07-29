import { describe, expect, it } from 'vitest'
import { isMouseBackButton, isMouseForwardButton } from '../../src/renderer/navigation'

describe('isMouseForwardButton', () => {
  it('recognises the forward thumb button', () => {
    expect(isMouseForwardButton({ button: 4 })).toBe(true)
  })

  it('is not confused with back', () => {
    // The pair has to stay distinct: one closes the details page, the other
    // reopens it, and swapping them would make both feel broken.
    expect(isMouseForwardButton({ button: 3 })).toBe(false)
    expect(isMouseBackButton({ button: 4 })).toBe(false)
  })

  it('ignores the ordinary buttons', () => {
    for (const button of [0, 1, 2]) {
      expect(isMouseForwardButton({ button }), `button ${button}`).toBe(false)
    }
  })
})

describe('isMouseBackButton', () => {
  it('recognises the browser-back thumb button', () => {
    // Chromium numbers the thumb buttons 3 (back) and 4 (forward); the
    // named constants stop at 2.
    expect(isMouseBackButton({ button: 3 })).toBe(true)
  })

  it('ignores the forward thumb button', () => {
    // Forward would have to mean "reopen the game I just closed", which is
    // state nothing keeps. Doing nothing beats guessing.
    expect(isMouseBackButton({ button: 4 })).toBe(false)
  })

  it('ignores the ordinary buttons', () => {
    // 0 left, 1 middle, 2 right. Left in particular reaches this handler on
    // every single click in the library — treating it as "back" would make
    // the details page impossible to open.
    for (const button of [0, 1, 2]) {
      expect(isMouseBackButton({ button }), `button ${button}`).toBe(false)
    }
  })
})
