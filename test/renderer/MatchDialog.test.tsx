/**
 * Correcting a match by hand.
 *
 * The brief for this component gave contracts rather than verbatim code, so
 * the shape below comes from reading MatchDialog.tsx directly. One contract
 * is security-relevant: applying a match must hand the main process the
 * entry's merge key, never a game id — the fixture below is built so the two
 * are visibly different strings, and both the positive and negative shape of
 * that assertion are checked (see "applies a match by the merge key").
 *
 * The component debounces its search by 250ms (`TYPING_PAUSE_MS`), so fake
 * timers are used throughout and restored afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MatchDialog } from '@renderer/components/MatchDialog'
import { entry, game, stubArcadia } from './fixtures'
import type { AppSuggestion } from '@shared/ipc'

function renderMatch(overrides: Partial<Parameters<typeof MatchDialog>[0]> = {}) {
  const props = {
    entry: entry('Team Fortress 2', [game('steam', '440', 'Team Fortress 2')]),
    onClose: vi.fn(),
    ...overrides
  }
  render(<MatchDialog {...props} />)
  return props
}

const suggestions: AppSuggestion[] = [
  { appId: 12345, name: 'Team Fortress 2' },
  { appId: 67890, name: 'Team Fortress 2 Beta' }
]

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Advances past the debounce and settles the state it triggers.
 *
 * React 18's own scheduler reaches for a timer too, so a promise resolved
 * inside `advanceTimersByTimeAsync(250)` does not necessarily reach the DOM
 * within that same call — a further zero-length advance flushes it. Without
 * this the assertions below would see the pre-search render.
 */
async function settleSearch(): Promise<void> {
  await vi.advanceTimersByTimeAsync(250)
  await vi.advanceTimersByTimeAsync(0)
}

describe('MatchDialog', () => {
  it('searches for the typed query only after the typing pause', async () => {
    const searchApps = vi.fn(async () => [])
    stubArcadia({ searchApps })
    renderMatch()
    // The mount itself queues a search for the entry's own name — clear that
    // timer before it fires so only the typed query is observed below.
    fireEvent.change(screen.getByPlaceholderText('Type a title…'), {
      target: { value: 'Portal' }
    })

    expect(searchApps).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(searchApps).toHaveBeenCalledWith('Portal')
  })

  it('renders results as a selectable list', async () => {
    stubArcadia({ searchApps: async () => suggestions })
    renderMatch()

    // A `findBy*` query would poll with a real setInterval and hang forever
    // under fake timers, so the debounce and the render it triggers are
    // both advanced by hand instead.
    await settleSearch()

    expect(screen.getByRole('button', { name: /Team Fortress 2.*12345/s })).toBeDefined()
    expect(screen.getByRole('button', { name: /Team Fortress 2 Beta.*67890/s })).toBeDefined()
  })

  it('applies a match by the merge key, not a game id', async () => {
    const setMatch = vi.fn(async () => ({ ok: true }))
    stubArcadia({ searchApps: async () => suggestions, setMatch })
    const props = renderMatch()
    // The fixture's merge key ('team fortress 2') and its game id
    // ('steam:440') are deliberately different strings, so a call with the
    // wrong one cannot pass by accident.
    expect(props.entry.key).toBe('team fortress 2')
    expect(props.entry.active.id).toBe('steam:440')

    await settleSearch()
    fireEvent.click(screen.getByRole('button', { name: /Team Fortress 2.*12345/s }))
    await vi.advanceTimersByTimeAsync(0)

    expect(setMatch).toHaveBeenCalledWith('team fortress 2', 12345)
    expect(setMatch).not.toHaveBeenCalledWith('steam:440', 12345)
  })

  it('closes the dialog once a match is saved', async () => {
    stubArcadia({ searchApps: async () => suggestions, setMatch: async () => ({ ok: true }) })
    const props = renderMatch()

    await settleSearch()
    fireEvent.click(screen.getByRole('button', { name: /Team Fortress 2.*12345/s }))
    await vi.advanceTimersByTimeAsync(0)

    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('shows the error and stays open when saving the match fails', async () => {
    stubArcadia({
      searchApps: async () => suggestions,
      setMatch: async () => ({ ok: false, error: 'Matching failed: offline' })
    })
    const props = renderMatch()

    await settleSearch()
    fireEvent.click(screen.getByRole('button', { name: /Team Fortress 2.*12345/s }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Matching failed: offline')).toBeDefined()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('shows the nothing-found hint, naming the app list as the likely reason', async () => {
    stubArcadia({ searchApps: async () => [] })
    renderMatch()

    await settleSearch()

    const hint = screen.getByText(/Nothing found\./)
    expect(hint).toBeDefined()
    expect(hint.textContent).toMatch(/app list/)
  })

  it('closes on cancel without saving a match', async () => {
    const setMatch = vi.fn(async () => ({ ok: true }))
    stubArcadia({ searchApps: async () => suggestions, setMatch })
    const props = renderMatch()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(props.onClose).toHaveBeenCalledOnce()
    expect(setMatch).not.toHaveBeenCalled()
  })

  it('shows the error when the search itself fails, distinct from a failed applyMatch', async () => {
    // Covers the .catch inside the debounce effect. The mount itself queues
    // a search for the entry's own name (see the comment in the first test
    // above), so settling that search is enough to reach the rejection -
    // no typing needed.
    stubArcadia({ searchApps: async () => Promise.reject(new Error('Search unavailable')) })
    renderMatch()

    await settleSearch()

    expect(screen.getByText('Search unavailable')).toBeDefined()
  })
})
