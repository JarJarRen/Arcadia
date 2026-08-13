/**
 * The "i" that reveals a store's detail.
 *
 * A disclosure rather than a dialog: it reveals static text and traps
 * nothing. What it must get right is Escape — the configuration screen it
 * lives in closes on Escape too, and the panel has to swallow the key before
 * that handler sees it.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InfoPopover } from '@renderer/components/InfoPopover'

describe('InfoPopover', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<InfoPopover label="Details about Steam" items={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps its detail hidden until asked', () => {
    render(<InfoPopover label="Details about EA" items={['Playtime is not reported.']} />)
    expect(screen.queryByText('Playtime is not reported.')).toBeNull()
  })

  it('reveals every line as its own entry', () => {
    render(
      <InfoPopover
        label="Details about EA"
        items={['Playtime is not reported.', 'Install size is not reported.']}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Details about EA' }))

    expect(screen.getByText('Playtime is not reported.')).toBeDefined()
    expect(screen.getByText('Install size is not reported.')).toBeDefined()
    // Separate entries, not one run-on paragraph — that is the whole point
    // of keeping limitations a list.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says whether it is open', () => {
    render(<InfoPopover label="Details about EA" items={['Only what is installed.']} />)
    const trigger = screen.getByRole('button', { name: 'Details about EA' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes again on a second press', () => {
    render(<InfoPopover label="Details about EA" items={['Only what is installed.']} />)
    const trigger = screen.getByRole('button', { name: 'Details about EA' })

    fireEvent.click(trigger)
    fireEvent.click(trigger)

    expect(screen.queryByText('Only what is installed.')).toBeNull()
  })

  it('moves focus into the panel so Escape has somewhere to land', () => {
    render(<InfoPopover label="Details about EA" items={['Only what is installed.']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Details about EA' }))

    // A <div> is not focusable without tabIndex; without this the key would
    // reach document instead, which is exactly the bug being avoided.
    expect(document.activeElement?.textContent).toContain('Only what is installed.')
  })

  it('closes on Escape and gives focus back to the trigger', () => {
    render(<InfoPopover label="Details about EA" items={['Only what is installed.']} />)
    const trigger = screen.getByRole('button', { name: 'Details about EA' })

    fireEvent.click(trigger)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(screen.queryByText('Only what is installed.')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('does not let Escape reach a handler above it', () => {
    // The configuration dialog listens for Escape on document. If the panel
    // let the key through, dismissing this popover would close the whole
    // screen behind it.
    let reachedDocument = false
    const listener = (): void => {
      reachedDocument = true
    }
    document.addEventListener('keydown', listener)

    render(<InfoPopover label="Details about EA" items={['Only what is installed.']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Details about EA' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    document.removeEventListener('keydown', listener)
    expect(reachedDocument).toBe(false)
  })

  it('closes on a press outside it', () => {
    render(<InfoPopover label="Details about EA" items={['Only what is installed.']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Details about EA' }))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByText('Only what is installed.')).toBeNull()
  })
})
