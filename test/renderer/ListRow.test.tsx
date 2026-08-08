/**
 * One row of the list view.
 *
 * The whole row is the button, not the title: a list is scanned and clicked
 * at speed, and a one-word target in a 380px row is a miss waiting to
 * happen. That is what the first test pins — clicking the metadata line has
 * to select the game just as clicking the name does.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ListRow } from '@renderer/components/ListRow'
import { entry, game, stubArcadia } from './fixtures'

const TF2 = entry('Team Fortress 2', [
  game('steam', '440', 'Team Fortress 2', { playtimeMinutes: 120 })
])

describe('ListRow', () => {
  it('selects the game when any part of the row is clicked', () => {
    stubArcadia()
    const onSelect = vi.fn()
    render(<ListRow entry={TF2} selected={false} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('Team Fortress 2'))

    expect(onSelect).toHaveBeenCalledWith(TF2)
  })

  it('marks the selected row for assistive technology', () => {
    stubArcadia()
    render(<ListRow entry={TF2} selected onSelect={vi.fn()} />)

    expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true')
  })

  it('says so when a game is not installed', () => {
    stubArcadia()
    const uninstalled = entry('Portal', [game('steam', '400', 'Portal', { installed: false })])
    render(<ListRow entry={uninstalled} selected={false} onSelect={vi.fn()} />)

    expect(screen.getByText('Not installed')).toBeDefined()
  })

  it('shows a badge per store the game is owned at', () => {
    stubArcadia()
    const merged = entry('Far Cry 4', [
      game('steam', '298110', 'Far Cry 4'),
      game('ubisoft', '856', 'Far Cry 4', { installed: false })
    ])
    render(<ListRow entry={merged} selected={false} onSelect={vi.fn()} />)

    expect(screen.getByText('Steam')).toBeDefined()
    expect(screen.getByText('Ubisoft')).toBeDefined()
  })

  it('marks a game that is not licensed to this account', () => {
    stubArcadia()
    const shared = entry('Shared Game', [game('steam', '1', 'Shared Game')], {
      sharedOrFree: true
    })
    render(<ListRow entry={shared} selected={false} onSelect={vi.fn()} />)

    expect(screen.getByText('Shared/Free')).toBeDefined()
  })

  it('reports artwork that fails to load', () => {
    // Steam's image URLs are derived from the AppID rather than reported,
    // so they can point at nothing. The failed request is the only signal
    // there is, and without the report the dead row keeps the game out of
    // the SteamGridDB fallback for good.
    const reportBrokenArtwork = vi.fn(async () => undefined)
    stubArcadia({ reportBrokenArtwork })

    const withArt = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      artwork: [{ kind: 'grid', url: 'https://example.invalid/440.jpg' }]
    })
    render(<ListRow entry={withArt} selected={false} onSelect={vi.fn()} />)

    // An <img alt=""> resolves to the "presentation" role, not "img" - an
    // empty alt is exactly the decorative-image case ARIA in HTML defines
    // that mapping for. `hidden: true` is still needed because the row
    // wraps its artwork in `aria-hidden="true"`.
    fireEvent.error(screen.getByRole('presentation', { hidden: true }))

    expect(reportBrokenArtwork).toHaveBeenCalledWith('team fortress 2', 'grid')
  })

  it('shows the install size for an installed game', () => {
    stubArcadia()
    const sized = entry('Team Fortress 2', [
      game('steam', '440', 'Team Fortress 2', { installSizeBytes: 21_474_836_480 })
    ])
    render(<ListRow entry={sized} selected={false} onSelect={vi.fn()} />)

    expect(screen.getByText('20.0 GB')).toBeDefined()
  })

  it('falls back to initials when there is no artwork', () => {
    stubArcadia()
    render(<ListRow entry={TF2} selected={false} onSelect={vi.fn()} />)

    expect(screen.getByText('TE')).toBeDefined()
  })
})
