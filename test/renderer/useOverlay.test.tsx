/**
 * Which overlay is open, and the one-step history behind it.
 *
 * The behaviour is what App.tsx already had for the details page: back
 * closes what is open, forward reopens what back just closed. This extracts
 * it so a second overlay kind can share it rather than duplicate it.
 */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOverlay } from '@renderer/hooks/useOverlay'

describe('useOverlay', () => {
  it('starts with nothing open', () => {
    const { result } = renderHook(() => useOverlay())
    expect(result.current.overlay).toBeUndefined()
  })

  it('opens a details page for a key', () => {
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('far cry 4'))
    expect(result.current.overlay).toEqual({ kind: 'detail', key: 'far cry 4' })
  })

  it('replaces a details page with the freebies page', () => {
    // The two are mutually exclusive: a freebie is by definition not in the
    // library, so its card opens no details page.
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('far cry 4'))
    act(() => result.current.openFreebies())
    expect(result.current.overlay).toEqual({ kind: 'freebies' })
  })

  it('reopens with forward what back has closed', () => {
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('far cry 4'))
    act(() => result.current.back())
    expect(result.current.overlay).toBeUndefined()
    act(() => result.current.forward())
    expect(result.current.overlay).toEqual({ kind: 'detail', key: 'far cry 4' })
  })

  it('remembers the freebies page for forward too', () => {
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openFreebies())
    act(() => result.current.back())
    act(() => result.current.forward())
    expect(result.current.overlay).toEqual({ kind: 'freebies' })
  })

  it('does nothing when back is pressed with nothing open', () => {
    // Going back twice from the same page is a no-op — both platforms can
    // deliver the thumb button, and on Windows both often do.
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.back())
    act(() => result.current.back())
    expect(result.current.overlay).toBeUndefined()
  })

  it('leaves the open page alone when forward is pressed', () => {
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('a'))
    act(() => result.current.forward())
    expect(result.current.overlay).toEqual({ kind: 'detail', key: 'a' })
  })

  it('closes the overlay with dismiss', () => {
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('far cry 4'))
    act(() => result.current.dismiss())
    expect(result.current.overlay).toBeUndefined()
  })

  it('does not let forward reopen what dismiss closed', () => {
    // dismiss is for closes the user did not make — a view-mode switch, a
    // library entry that vanished — so forward must have nothing to offer
    // afterwards.
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('far cry 4'))
    act(() => result.current.dismiss())
    act(() => result.current.forward())
    expect(result.current.overlay).toBeUndefined()
  })

  it('leaves a real back() memory alone when dismiss runs afterwards', () => {
    // dismiss must only clear what is currently open, never overwrite
    // forward's memory of a page the user actually closed with back().
    const { result } = renderHook(() => useOverlay())
    act(() => result.current.openDetail('a'))
    act(() => result.current.back())
    act(() => result.current.openDetail('b'))
    act(() => result.current.dismiss())
    act(() => result.current.forward())
    expect(result.current.overlay).toEqual({ kind: 'detail', key: 'a' })
  })
})
