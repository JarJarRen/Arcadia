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

describe('StoreFilterMenu', () => {
  it('opens on a click of the trigger', () => {
    render(<StoreFilterMenu stores={[]} onChange={vi.fn()} />)

    const trigger = screen.getByLabelText('Store')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu')).toBeDefined()
  })

  it('adds a store to the selection', () => {
    const onChange = vi.fn()
    render(<StoreFilterMenu stores={[]} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(onChange).toHaveBeenCalledWith(['steam'])
  })

  it('removes a store that was already selected', () => {
    const onChange = vi.fn()
    render(<StoreFilterMenu stores={['steam', 'epic']} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(onChange).toHaveBeenCalledWith(['epic'])
  })

  it('stays open after a store is picked', () => {
    render(<StoreFilterMenu stores={[]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /steam/i }))

    expect(screen.queryByRole('menu')).not.toBeNull()
  })

  it('clears the selection and closes on "All stores"', () => {
    const onChange = vi.fn()
    render(<StoreFilterMenu stores={['steam', 'epic']} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /all stores/i }))

    expect(onChange).toHaveBeenCalledWith([])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks the selected stores as checked', () => {
    render(<StoreFilterMenu stores={['steam']} onChange={vi.fn()} />)

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
    render(<StoreFilterMenu stores={[]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<StoreFilterMenu stores={[]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Store'))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('names the selection on the trigger rather than repeating the button', () => {
    render(<StoreFilterMenu stores={['steam', 'epic']} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Store').getAttribute('title')).toMatch(/Store:/)
  })
})
