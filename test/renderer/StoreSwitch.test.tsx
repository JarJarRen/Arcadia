/**
 * The store switch on a merged game's tile.
 *
 * Only shown once there is something to choose between: a single-source
 * entry gets no switch at all, which the first test pins directly rather
 * than leaving it to be inferred from the others.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StoreSwitch } from '@renderer/components/StoreSwitch'
import { entry, game, stubArcadia } from './fixtures'

const FARCRY = entry('Far Cry 4', [
  game('steam', '298110', 'Far Cry 4'),
  game('ubisoft', '856', 'Far Cry 4', { installed: false })
])

describe('StoreSwitch', () => {
  it('renders nothing for an entry with a single source', () => {
    stubArcadia()
    const single = entry('Portal', [game('steam', '400', 'Portal')])
    const { container } = render(
      <StoreSwitch entry={single} onSelect={vi.fn()} onSplit={vi.fn()} />
    )

    // No jest-dom matchers are wired into this project's vitest setup, so
    // "renders nothing" is checked directly against the container.
    expect(container.firstChild).toBeNull()
  })

  it('calls onSelect with the clicked source id', () => {
    stubArcadia()
    const onSelect = vi.fn()
    render(<StoreSwitch entry={FARCRY} onSelect={onSelect} onSplit={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Ubisoft/ }))

    expect(onSelect).toHaveBeenCalledWith('ubisoft:856')
  })

  it('marks the active source as pressed and the others as not', () => {
    stubArcadia()
    render(<StoreSwitch entry={FARCRY} onSelect={vi.fn()} onSplit={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Steam' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(screen.getByRole('button', { name: /Ubisoft/ }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('titles a store where the game is not installed', () => {
    stubArcadia()
    render(<StoreSwitch entry={FARCRY} onSelect={vi.fn()} onSplit={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Ubisoft/ }).getAttribute('title')).toBe(
      'Ubisoft — not installed there'
    )
  })

  it('calls onSplit when the split control is clicked', () => {
    stubArcadia()
    const onSplit = vi.fn()
    render(<StoreSwitch entry={FARCRY} onSelect={vi.fn()} onSplit={onSplit} />)

    fireEvent.click(screen.getByRole('button', { name: 'split' }))

    expect(onSplit).toHaveBeenCalledOnce()
  })
})
