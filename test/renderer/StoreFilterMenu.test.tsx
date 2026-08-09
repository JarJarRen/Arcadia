/**
 * The store filter popover.
 *
 * Two behaviours carry the whole design. Picking a store keeps the panel
 * open, because choosing three stores should cost three clicks rather than
 * three trips back to the button. And "All stores" is one click, because
 * unticking four boxes to get back to the whole library would be a poor
 * trade.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StoreFilterMenu } from '@renderer/components/StoreFilterMenu'
import { STORE_IDS } from '@shared/types'

describe('StoreFilterMenu', () => {
  it('opens on a click of the trigger', () => {
    render(<StoreFilterMenu stores={[]} available={[...STORE_IDS]} onChange={vi.fn()} />)

    const trigger = screen.getByLabelText('Store')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu')).toBeDefined()
  })

  it('adds a store to the selection', () => {
    const onChange = vi.fn()
    render(<StoreFilterMenu stores={[]} available={[...STORE_IDS]} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(onChange).toHaveBeenCalledWith(['steam'])
  })

  it('removes a store that was already selected', () => {
    const onChange = vi.fn()
    render(<StoreFilterMenu stores={['steam', 'epic']} available={[...STORE_IDS]} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(onChange).toHaveBeenCalledWith(['epic'])
  })

  it('stays open after a store is picked', () => {
    // This dispatches a `click` only, so it does not exercise useDismiss's
    // mousedown listener at all — it pins the onChange-does-not-close
    // behaviour, not the "click landed inside" guard. See the mousedown
    // test below for that.
    render(<StoreFilterMenu stores={[]} available={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(screen.queryByRole('menu')).not.toBeNull()
  })

  it('stays open on a mousedown that lands inside the panel', () => {
    // useDismiss listens on mousedown, not click (useDismiss.ts:29), so this
    // is what actually exercises the `root.current?.contains(event.target)`
    // branch that keeps the panel open for a click on one of its own items.
    render(<StoreFilterMenu stores={[]} available={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.mouseDown(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(screen.queryByRole('menu')).not.toBeNull()
  })

  it('clears the selection and closes on "All stores"', () => {
    const onChange = vi.fn()
    render(<StoreFilterMenu stores={['steam', 'epic']} available={[...STORE_IDS]} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /all stores/i }))

    expect(onChange).toHaveBeenCalledWith([])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks the selected stores as checked', () => {
    render(<StoreFilterMenu stores={['steam']} available={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))

    expect(
      screen.getByRole('menuitemcheckbox', { name: /steam/i }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen.getByRole('menuitemcheckbox', { name: /epic/i }).getAttribute('aria-checked')
    ).toBe('false')
  })

  it('closes on a click outside it', () => {
    // mousedown rather than click, deliberately: the panel has to be gone
    // before whatever was clicked underneath it reacts.
    render(<StoreFilterMenu stores={[]} available={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<StoreFilterMenu stores={[]} available={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('names the selection on the trigger rather than repeating the button', () => {
    render(<StoreFilterMenu stores={['steam', 'epic']} available={[...STORE_IDS]} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Store').getAttribute('title')).toMatch(/Store:/)
  })

  it('lists only the stores it was given', () => {
    render(<StoreFilterMenu stores={[]} available={['steam', 'ea']} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))

    expect(screen.getByRole('menuitemcheckbox', { name: /steam/i })).toBeDefined()
    expect(screen.queryByRole('menuitemcheckbox', { name: /epic/i })).toBeNull()
  })

  it('still offers "All stores" when only one store is enabled', () => {
    // The neutral state is not the same as "the one store": it survives a
    // second store being switched on later.
    render(<StoreFilterMenu stores={['steam']} available={['steam']} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))

    expect(screen.getByRole('menuitemradio', { name: /all stores/i })).toBeDefined()
  })
})
