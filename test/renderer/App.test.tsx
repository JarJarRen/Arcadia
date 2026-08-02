/**
 * The shell that wires everything together.
 *
 * Tested at this level because most of what can break here is a wiring
 * mistake between two components that are each fine on their own: a filter
 * that does not reach the library, a detail page that keeps showing the
 * entry it was opened with after a refresh rebuilt it.
 *
 * The brief for this file gave only a contract list and a one-test skeleton,
 * guessed from prop signatures rather than read from the component, so the
 * shape below comes from reading App.tsx directly. Two mismatches turned up
 * on the way: the brief describes the mouse back button as something App
 * "listens for" on the window, but the Windows path is a main-process
 * app-command delivered through `window.arcadia.onNavigateBack` — there is
 * no DOM event to fire — so that test captures and invokes the callback
 * instead of dispatching a `mouseup`. And the gear's "Settings" popover has
 * to be opened before its "Configuration…" item is reachable at all; the
 * brief's contract list treats the click as a single step.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '@renderer/App'
import { entry, game, stubArcadia } from './fixtures'

const TF2 = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')])
const PORTAL = entry('Portal', [game('steam', '400', 'Portal', { installed: false })])

describe('App', () => {
  it('renders the library it was given', async () => {
    stubArcadia({ getGames: async () => [TF2, PORTAL] })
    render(<App />)

    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())
    expect(screen.getByText('Portal')).toBeDefined()
  })

  it('the search box filters the visible list', async () => {
    stubArcadia({ getGames: async () => [TF2, PORTAL] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Portal')).toBeDefined())

    // The search field carries no accessible name of its own — no label, no
    // aria-label, just a placeholder, which accname computation does not
    // draw on — so it is queried by placeholder text rather than role+name.
    fireEvent.change(screen.getByPlaceholderText('Search library…'), {
      target: { value: 'Team' }
    })

    expect(screen.getByText('Team Fortress 2')).toBeDefined()
    expect(screen.queryByText('Portal')).toBeNull()
  })

  it('the count reflects the filter', async () => {
    stubArcadia({ getGames: async () => [TF2, PORTAL] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Portal')).toBeDefined())

    // See the previous test for why this is queried by placeholder rather
    // than accessible name.
    fireEvent.change(screen.getByPlaceholderText('Search library…'), {
      target: { value: 'Team' }
    })

    // The toolbar carries a second, hidden copy of "shown of total" at its
    // widest (total of total) purely to hold the row's width still, so this
    // text is only ever produced by the real, visible counter once shown and
    // total differ.
    expect(screen.getByText('1 of 2')).toBeDefined()
  })

  it('ticking "Installed only" hides uninstalled games and does not clear the search', async () => {
    // Both names contain "a", so this search leaves both entries visible —
    // the point is not what the search matches, but whether it survives the
    // checkbox. A handler that replaces the filter object instead of
    // patching it would both wipe the search box back to empty and drop the
    // search term from the applied filter; asserting the input's own value
    // catches the first, and Portal's continued absence alone would not
    // distinguish "filtered by installed" from "filtered by installed AND
    // search got cleared to nothing", since either leaves Portal hidden.
    stubArcadia({ getGames: async () => [TF2, PORTAL] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Portal')).toBeDefined())

    // See the search-filter test above for why this is queried by
    // placeholder rather than accessible name.
    const search = screen.getByPlaceholderText('Search library…')
    fireEvent.change(search, { target: { value: 'a' } })
    expect(screen.getByText('Team Fortress 2')).toBeDefined()
    expect(screen.getByText('Portal')).toBeDefined()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Installed only' }))

    expect(screen.queryByText('Portal')).toBeNull()
    expect(screen.getByText('Team Fortress 2')).toBeDefined()
    expect((search as HTMLInputElement).value).toBe('a')
  })

  it('switching to list view renders the list pane and the nothing-selected hint', async () => {
    stubArcadia({ getGames: async () => [TF2, PORTAL] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Portal')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'List' }))

    expect(screen.getByText('Pick a game from the list.')).toBeDefined()
  })

  it('opening a game shows its detail page; the back control returns to the library', async () => {
    stubArcadia({ getGames: async () => [TF2] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Team Fortress 2' }))

    expect(screen.getByRole('button', { name: '← Back to library' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '← Back to library' }))

    expect(screen.queryByRole('button', { name: '← Back to library' })).toBeNull()
  })

  it('the open entry survives a library reload, showing the changed data', async () => {
    // App remembers the merge key, not the entry itself, precisely because
    // `entries` is rebuilt wholesale on every reload. A test that only
    // reopens the page would pass even if App captured a stale copy at open
    // time; what actually discriminates that design is firing a reload with
    // *different* data for the same key and checking the open page picks it
    // up, which is what this test does via `onLibraryChanged`.
    const before = TF2
    const after = entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')], {
      metadata: {
        developers: [],
        publishers: [],
        genres: ['Action'],
        screenshots: [],
        fetchAttempts: 1
      }
    })
    let changed: (() => void) | undefined
    let call = 0
    stubArcadia({
      getGames: async () => (call++ === 0 ? [before] : [after]),
      onLibraryChanged: (callback) => {
        changed = callback
        return () => undefined
      }
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Team Fortress 2' }))
    expect(screen.getByRole('button', { name: '← Back to library' })).toBeDefined()
    expect(screen.queryByText('Action')).toBeNull()

    await act(async () => {
      changed?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText('Action')).toBeDefined())
    // Still on the details page throughout — this is the same page picking
    // up new data, not a close-and-reopen.
    expect(screen.getByRole('button', { name: '← Back to library' })).toBeDefined()
  })

  it('the mouse back button closes the detail page', async () => {
    // Windows delivers the thumb buttons to the window as an app-command,
    // never as a DOM `mouseup`, so App exposes no window listener for this
    // path — it registers a callback with `window.arcadia.onNavigateBack`
    // instead. Capturing and invoking that callback is therefore the only
    // way to exercise this path; dispatching a `mouseup` here would just
    // pin the Linux-only branch that `navigation.ts` already covers on its
    // own.
    let onBack: (() => void) | undefined
    stubArcadia({
      getGames: async () => [TF2],
      onNavigateBack: (callback) => {
        onBack = callback
        return () => undefined
      }
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Team Fortress 2' }))
    expect(screen.getByRole('button', { name: '← Back to library' })).toBeDefined()

    act(() => onBack?.())

    expect(screen.queryByRole('button', { name: '← Back to library' })).toBeNull()
  })

  it('a load error is displayed and can be dismissed', async () => {
    stubArcadia({
      getGames: async () => {
        throw new Error('boom')
      }
    })
    render(<App />)

    await screen.findByRole('alert')
    expect(screen.getByText('Could not load the library: boom')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Dismiss message'))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('"+ Add game" opens the add dialog; cancelling closes it', async () => {
    stubArcadia({ getGames: async () => [TF2] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: '+ Add game' }))

    expect(screen.getByRole('dialog', { name: 'Add a game by hand' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Add a game by hand' })).toBeNull()
  })

  it("the gear's configuration entry opens the setup dialog", async () => {
    stubArcadia({ getGames: async () => [TF2] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configuration…' }))

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Configure API keys' })).toBeDefined()
    )
  })

  it('first run opens the setup dialog by itself when the question is unanswered', async () => {
    stubArcadia({
      getGames: async () => [TF2],
      getEnvConfig: async () => ({
        values: { STEAM_WEB_API_KEY: '', STEAM_ID64: '', STEAMGRIDDB_API_KEY: '' },
        done: false,
        path: 'C:\\test\\.env'
      })
    })
    render(<App />)

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Configure API keys' })).toBeDefined()
    )
    // The gate: on a first run there is no way out except answering it.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('does not open the setup dialog when the question has already been answered', async () => {
    // stubArcadia's default getEnvConfig reports done: true.
    stubArcadia({ getGames: async () => [TF2] })
    render(<App />)

    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())
    expect(screen.queryByRole('dialog', { name: 'Configure API keys' })).toBeNull()
  })

  /**
   * Wiring: App.tsx passes five callbacks straight through to <Library> —
   * `onLaunch={(entry) => void launch(entry)}` and four siblings alongside
   * it. Every other test that exercises these — GameCard.test.tsx,
   * ListRow.test.tsx, GameDetail.test.tsx — hands the child component a
   * `vi.fn()` stand-in and checks that the child calls whatever prop it was
   * given. That pins each component in isolation; it proves nothing about
   * whether App wired the right prop to the right handler. A swap at
   * App.tsx:353-357 (`onInstall` wired to `launch`, or the wrong argument
   * handed to `onSelectStore`) would pass all of those and go unnoticed. The
   * five tests below render the real App, click the real control on the
   * grid tile, and assert the real `window.arcadia` method was called with
   * the right argument — the only place such a swap would actually fail.
   */
  it('the grid tile launches an installed game via window.arcadia.launch', async () => {
    const launch = vi.fn(async () => ({ ok: true }))
    const install = vi.fn(async () => ({ ok: true }))
    stubArcadia({ getGames: async () => [TF2], launch, install })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play' }))
      await Promise.resolve()
    })

    // Paired with the install test below: a swap between the two wrappers
    // would leave this button calling install() instead, so both directions
    // have to be checked for the pair to mean anything.
    expect(launch).toHaveBeenCalledWith(TF2.active.id)
    expect(install).not.toHaveBeenCalled()
  })

  it('the grid tile installs an uninstalled game via window.arcadia.install, not launch', async () => {
    const launch = vi.fn(async () => ({ ok: true }))
    const install = vi.fn(async () => ({ ok: true }))
    stubArcadia({ getGames: async () => [PORTAL], launch, install })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Portal')).toBeDefined())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }))
      await Promise.resolve()
    })

    expect(install).toHaveBeenCalledWith(PORTAL.active.id)
    expect(launch).not.toHaveBeenCalled()
  })

  it('the grid tile toggles favourite via window.arcadia.setFavorite, keyed by the merge key', async () => {
    const setFavorite = vi.fn(async () => undefined)
    stubArcadia({ getGames: async () => [TF2], setFavorite })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Team Fortress 2')).toBeDefined())

    await act(async () => {
      // TF2's merge key ("team fortress 2") and its active source id
      // ("steam:440") differ, so passing the wrong one here would fail.
      fireEvent.click(screen.getByLabelText('Mark as favourite'))
      await Promise.resolve()
    })

    expect(setFavorite).toHaveBeenCalledWith(TF2.key, true)
  })

  it("the grid tile's store switch calls window.arcadia.setPreferredStore with the merge key and the chosen source id", async () => {
    const setPreferredStore = vi.fn(async () => undefined)
    const merged = entry('Far Cry 4', [
      game('steam', '298110', 'Far Cry 4'),
      game('ubisoft', '856', 'Far Cry 4')
    ])
    stubArcadia({ getGames: async () => [merged], setPreferredStore })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Far Cry 4')).toBeDefined())

    await act(async () => {
      // The merge key ("far cry 4") and the chosen source id ("ubisoft:856")
      // differ, so a handler that mixed the two arguments up would fail
      // this assertion.
      fireEvent.click(screen.getByRole('button', { name: 'Ubisoft' }))
      await Promise.resolve()
    })

    expect(setPreferredStore).toHaveBeenCalledWith(merged.key, 'ubisoft:856')
  })

  it("the grid tile's split control calls window.arcadia.setSplit with the merge key", async () => {
    const setSplit = vi.fn(async () => undefined)
    const merged = entry('Far Cry 4', [
      game('steam', '298110', 'Far Cry 4'),
      game('ubisoft', '856', 'Far Cry 4')
    ])
    stubArcadia({ getGames: async () => [merged], setSplit })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Far Cry 4')).toBeDefined())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'split' }))
      await Promise.resolve()
    })

    expect(setSplit).toHaveBeenCalledWith(merged.key, true)
  })
})
