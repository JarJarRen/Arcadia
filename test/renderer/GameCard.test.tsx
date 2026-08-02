/**
 * The grid tile.
 *
 * The brief for this component described the artwork itself as the click
 * target for opening details, named "Details for <game>". Reading the
 * component shows otherwise: the artwork is `aria-hidden` and inert; the
 * clickable element is the title button, and its accessible name is the
 * game's own name, taken from its visible content rather than a separate
 * label. The tests below pin what the component actually does.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GameCard } from '@renderer/components/GameCard'
import { entry, game, stubArcadia } from './fixtures'

function renderCard(overrides: Partial<Parameters<typeof GameCard>[0]> = {}) {
  const props = {
    entry: entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')]),
    onLaunch: vi.fn(),
    onToggleFavorite: vi.fn(),
    onSelectStore: vi.fn(),
    onSplit: vi.fn(),
    onOpen: vi.fn(),
    onInstall: vi.fn(),
    ...overrides
  }
  render(<GameCard {...props} />)
  return props
}

describe('GameCard', () => {
  it('shows Play for an installed game and calls onLaunch', () => {
    stubArcadia()
    const props = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(props.onLaunch).toHaveBeenCalledWith(props.entry)
  })

  it('shows Install for an uninstalled game and calls onInstall', () => {
    stubArcadia()
    const uninstalled = entry('Portal', [game('steam', '400', 'Portal', { installed: false })])
    const props = renderCard({ entry: uninstalled })

    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(props.onInstall).toHaveBeenCalledWith(uninstalled)
  })

  it('calls onOpen with the entry when the title is clicked', () => {
    // The brief's guessed accessible name, "Details for Team Fortress 2",
    // does not occur anywhere in the rendered output. What actually opens
    // the details page is the title button, named after the game itself.
    stubArcadia()
    const props = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Team Fortress 2' }))

    expect(props.onOpen).toHaveBeenCalledWith(props.entry)
  })

  it('offers to mark a game as a favourite and calls onToggleFavorite', () => {
    stubArcadia()
    const props = renderCard()

    fireEvent.click(screen.getByLabelText('Mark as favourite'))

    expect(props.onToggleFavorite).toHaveBeenCalledWith(props.entry)
  })

  it('offers to remove a favourite once it is one', () => {
    stubArcadia()
    const favourite = entry('Team Fortress 2', [
      game('steam', '440', 'Team Fortress 2', { favorite: true })
    ])
    renderCard({ entry: favourite })

    expect(screen.getByLabelText('Remove favourite')).toBeDefined()
    expect(screen.queryByLabelText('Mark as favourite')).toBeNull()
  })

  it('renders the store switch for a merged entry and reports a store pick', () => {
    stubArcadia()
    const merged = entry('Far Cry 4', [
      game('steam', '298110', 'Far Cry 4'),
      game('ubisoft', '856', 'Far Cry 4')
    ])
    const props = renderCard({ entry: merged })

    fireEvent.click(screen.getByRole('button', { name: 'Ubisoft' }))

    expect(props.onSelectStore).toHaveBeenCalledWith(merged, 'ubisoft:856')
  })

  it('reports a split of a merged entry', () => {
    stubArcadia()
    const merged = entry('Far Cry 4', [
      game('steam', '298110', 'Far Cry 4'),
      game('ubisoft', '856', 'Far Cry 4')
    ])
    const props = renderCard({ entry: merged })

    fireEvent.click(screen.getByRole('button', { name: 'split' }))

    expect(props.onSplit).toHaveBeenCalledWith(merged)
  })

  it('reports artwork that fails to load', () => {
    const reportBrokenArtwork = vi.fn(async () => undefined)
    stubArcadia({ reportBrokenArtwork })
    const withArt = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      artwork: [{ kind: 'grid', url: 'https://example.invalid/440.jpg' }]
    })
    renderCard({ entry: withArt })

    // An <img alt=""> resolves to the "presentation" role, not "img"; see
    // ListRow.test.tsx for the same correction against the brief's guess.
    fireEvent.error(screen.getByRole('presentation', { hidden: true }))

    expect(reportBrokenArtwork).toHaveBeenCalledWith('team fortress 2', 'grid')
  })

  it('falls back to hero artwork when there is no grid image', () => {
    stubArcadia()
    const heroOnly = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      artwork: [{ kind: 'hero', url: 'https://example.invalid/440-hero.jpg' }]
    })
    renderCard({ entry: heroOnly })

    expect(
      screen.getByRole('presentation', { hidden: true }).getAttribute('src')
    ).toBe('https://example.invalid/440-hero.jpg')
  })

  it('shows the Shared/Free badge for a game not licensed to this account', () => {
    stubArcadia()
    const shared = entry('Shared Game', [game('steam', '1', 'Shared Game')], {
      sharedOrFree: true
    })
    renderCard({ entry: shared })

    expect(screen.getByText('Shared/Free')).toBeDefined()
  })
})
