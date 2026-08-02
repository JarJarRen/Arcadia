/**
 * The details page — the largest component in the app.
 *
 * The brief for this file gave only prop signatures, so the contracts below
 * were read out of the component itself rather than guessed. One is
 * security-relevant: the folder control must hand the main process the
 * merge key, never a filesystem path, because the main process resolves
 * the path itself precisely so an injected string cannot be used to open an
 * arbitrary folder (see test/main/ipc-openfolder.test.ts).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GameDetail } from '@renderer/pages/GameDetail'
import { entry, game, stubArcadia } from './fixtures'

function renderDetail(overrides: Partial<Parameters<typeof GameDetail>[0]> = {}) {
  const props = {
    entry: entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')]),
    onClose: vi.fn(),
    onLaunch: vi.fn(),
    onToggleFavorite: vi.fn(),
    onSelectStore: vi.fn(),
    onInstall: vi.fn(),
    ...overrides
  }
  render(<GameDetail {...props} />)
  return props
}

describe('GameDetail', () => {
  it('renders the page variant, back control included', () => {
    stubArcadia()
    renderDetail()

    expect(screen.getByRole('button', { name: '← Back to library' })).toBeDefined()
  })

  it('renders the pane variant without throwing, and without a back control', () => {
    // onClose is unreachable through the UI in this variant by construction
    // — there is no back button to click — so it is asserted on the page
    // variant instead.
    stubArcadia()
    renderDetail({ variant: 'pane' })

    expect(screen.queryByRole('button', { name: '← Back to library' })).toBeNull()
  })

  it('calls onClose from the back control', () => {
    stubArcadia()
    const props = renderDetail()

    fireEvent.click(screen.getByRole('button', { name: '← Back to library' }))

    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('shows Play for an installed game and calls onLaunch with the entry', () => {
    stubArcadia()
    const props = renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(props.onLaunch).toHaveBeenCalledWith(props.entry)
  })

  it('shows Install for an uninstalled game and calls onInstall with the entry', () => {
    stubArcadia()
    const uninstalled = entry('Portal', [game('steam', '400', 'Portal', { installed: false })])
    const props = renderDetail({ entry: uninstalled })

    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(props.onInstall).toHaveBeenCalledWith(uninstalled)
  })

  it('calls onToggleFavorite from the favourite control', () => {
    stubArcadia()
    const props = renderDetail()

    fireEvent.click(screen.getByLabelText('Mark as favourite'))

    expect(props.onToggleFavorite).toHaveBeenCalledWith(props.entry)
  })

  it('opens the folder by the merge key, never a path', async () => {
    const openFolder = vi.fn(async () => ({ ok: true }))
    stubArcadia({ openFolder })
    const withPath = entry('Team Fortress 2', [
      game('steam', '440', 'Team Fortress 2', { installPath: 'C:\\Games\\Team Fortress 2' })
    ])
    renderDetail({ entry: withPath })

    fireEvent.click(screen.getByRole('button', { name: 'Show in file manager' }))

    await waitFor(() => expect(openFolder).toHaveBeenCalledWith(withPath.key))
    expect(openFolder).not.toHaveBeenCalledWith(withPath.installPath)
  })

  it('shows the no-metadata hint and offers to match by hand', () => {
    stubArcadia()
    renderDetail()

    expect(
      screen.getByText(/No details available for this game yet/)
    ).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Match this game by hand' }))

    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('shows genres, developers and the release date once metadata arrives', () => {
    stubArcadia()
    const withMetadata = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      metadata: {
        developers: ['Valve'],
        publishers: ['Valve Publishing'],
        genres: ['Action'],
        releaseDate: '10 October 2007',
        screenshots: [],
        fetchAttempts: 1
      }
    })
    renderDetail({ entry: withMetadata })

    expect(screen.getByText('Action')).toBeDefined()
    expect(screen.getByText('Valve')).toBeDefined()
    expect(screen.getByText('10 October 2007')).toBeDefined()
    expect(screen.queryByText(/No details available/)).toBeNull()
  })

  it('enlarges a screenshot on click, and the enlarged view can be closed', () => {
    // Both the gallery thumbnails and the lightbox's own enlarged copy are
    // <img alt=""> - decorative, so both resolve to the "presentation"
    // role and neither carries an accessible name that would tell them
    // apart. What is asserted instead is the state change itself: opening
    // the lightbox adds two new presentation-role nodes (the overlay and
    // its image), and closing it removes exactly those two again.
    stubArcadia()
    const withShots = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      metadata: {
        developers: [],
        publishers: [],
        genres: [],
        screenshots: [
          'https://example.invalid/shot1.jpg',
          'https://example.invalid/shot2.jpg'
        ],
        fetchAttempts: 1
      }
    })
    renderDetail({ entry: withShots })

    const before = screen.queryAllByRole('presentation', { hidden: true })

    fireEvent.click(screen.getAllByRole('button', { name: 'Enlarge screenshot' })[0]!)

    const after = screen.queryAllByRole('presentation', { hidden: true })
    expect(after.length).toBe(before.length + 2)

    const opened = after.find((element) => !before.includes(element))
    fireEvent.click(opened!)

    expect(screen.queryAllByRole('presentation', { hidden: true }).length).toBe(before.length)
  })

  it('offers to remove a hand-made entry and calls removeManualGame with its source id', async () => {
    const removeManualGame = vi.fn(async () => ({ ok: true }))
    stubArcadia({ removeManualGame })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const manual = entry('Custom Game', [
      game('steam', 'manual-1', 'Custom Game', { manual: true })
    ])
    const props = renderDetail({ entry: manual })

    fireEvent.click(screen.getByRole('button', { name: 'Remove from library' }))

    await waitFor(() => expect(removeManualGame).toHaveBeenCalledWith('steam:manual-1'))
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce())
  })

  it('leaves the game in the library when the removal confirmation is declined', () => {
    const removeManualGame = vi.fn(async () => ({ ok: true }))
    stubArcadia({ removeManualGame })
    // Restored locally at the end of the test: there is no global
    // restoreMocks (see test/renderer/setup.ts), and a neighbouring test
    // that spies on window.confirm without checking its own return value
    // should not inherit this one's `false`.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const manual = entry('Custom Game', [
      game('steam', 'manual-1', 'Custom Game', { manual: true })
    ])
    const props = renderDetail({ entry: manual })

    fireEvent.click(screen.getByRole('button', { name: 'Remove from library' }))

    expect(removeManualGame).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('offers no remove control for a scanned entry', () => {
    stubArcadia()
    renderDetail()

    expect(screen.queryByRole('button', { name: 'Remove from library' })).toBeNull()
  })

  it('reports hero artwork that fails to load', () => {
    const reportBrokenArtwork = vi.fn(async () => undefined)
    stubArcadia({ reportBrokenArtwork })
    const withHero = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      artwork: [{ kind: 'hero', url: 'https://example.invalid/440-hero.jpg' }]
    })
    renderDetail({ entry: withHero })

    fireEvent.error(screen.getByRole('presentation', { hidden: true }))

    expect(reportBrokenArtwork).toHaveBeenCalledWith('team fortress 2', 'hero')
  })

  it('shows a dismissible error banner when the folder cannot be opened', async () => {
    const openFolder = vi.fn(async () => ({ ok: false, error: 'Folder not found' }))
    stubArcadia({ openFolder })
    const withPath = entry('Team Fortress 2', [
      game('steam', '440', 'Team Fortress 2', { installPath: 'C:\\Games\\Team Fortress 2' })
    ])
    renderDetail({ entry: withPath })

    fireEvent.click(screen.getByRole('button', { name: 'Show in file manager' }))

    await screen.findByRole('alert')
    expect(screen.getByText('Folder not found')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Dismiss message'))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a store switch from the origin list, distinct from the tile switch', () => {
    // This is a second, independent switcher: the facts column on the
    // details page, not the StoreSwitch component the grid tile uses.
    stubArcadia()
    const merged = entry('Far Cry 4', [
      game('steam', '298110', 'Far Cry 4'),
      game('ubisoft', '856', 'Far Cry 4')
    ])
    const props = renderDetail({ entry: merged })

    fireEvent.click(screen.getByRole('button', { name: 'Ubisoft' }))

    expect(props.onSelectStore).toHaveBeenCalledWith(merged, 'ubisoft:856')
  })

  it('disables the origin control when there is only one source', () => {
    stubArcadia()
    renderDetail()

    expect(screen.getByRole('button', { name: 'Steam' }).hasAttribute('disabled')).toBe(true)
  })

  it('closes the match dialog on Cancel without saving a match', () => {
    stubArcadia()
    renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Match this game by hand' }))
    expect(screen.getByRole('dialog')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the page on Escape when nothing else is open', () => {
    stubArcadia()
    const props = renderDetail()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('lets Escape peel off one layer at a time, innermost first', () => {
    // Documented ordering: the lightbox closes before the dialog, and the
    // dialog closes before the page itself - never everything at once.
    stubArcadia()
    const withShots = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      metadata: {
        developers: [],
        publishers: [],
        genres: [],
        screenshots: ['https://example.invalid/shot1.jpg'],
        fetchAttempts: 1
      }
    })
    const props = renderDetail({ entry: withShots })

    // Metadata is present here, so the correction control reads "Wrong game
    // matched?" rather than "Match this game by hand" - see the metadata
    // test above for that distinction.
    fireEvent.click(screen.getByRole('button', { name: 'Wrong game matched?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge screenshot' }))
    expect(screen.getByRole('dialog')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(props.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(props.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('shows an error banner rather than closing when a manual removal fails', async () => {
    const removeManualGame = vi.fn(async () => ({ ok: false, error: 'Still installed' }))
    stubArcadia({ removeManualGame })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const manual = entry('Custom Game', [
      game('steam', 'manual-1', 'Custom Game', { manual: true })
    ])
    const props = renderDetail({ entry: manual })

    fireEvent.click(screen.getByRole('button', { name: 'Remove from library' }))

    await screen.findByText('Still installed')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('shows the thrown error message when opening the folder rejects', async () => {
    const openFolder = vi.fn(async () => {
      throw new Error('No such device')
    })
    stubArcadia({ openFolder })
    const withPath = entry('Team Fortress 2', [
      game('steam', '440', 'Team Fortress 2', { installPath: 'C:\\Games\\Team Fortress 2' })
    ])
    renderDetail({ entry: withPath })

    fireEvent.click(screen.getByRole('button', { name: 'Show in file manager' }))

    await screen.findByText('No such device')
  })
})
