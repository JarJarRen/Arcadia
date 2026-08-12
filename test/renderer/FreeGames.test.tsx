/**
 * The page.
 *
 * Its three jobs: show what is free, keep the kinds separable, and never
 * go blank because a third party had an outage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FreeGames } from '@renderer/pages/FreeGames'
import type { FreebieList } from '@shared/freebies'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

const LIST: FreebieList = {
  current: [
    {
      id: 'epic:ghostrunner',
      storeId: 'epic',
      title: 'Ghostrunner',
      kind: 'game',
      storeGameId: 'ghostrunner',
      source: 'epic',
      claim: 'unclaimed',
      endsAt: NOW + 2 * 86_400_000
    },
    {
      id: 'ubisoft:skin pack',
      storeId: 'ubisoft',
      title: 'Skin Pack',
      kind: 'dlc',
      claimUrl: 'https://www.gamerpower.com/open/skin',
      source: 'gamerpower',
      claim: 'unclaimed'
    }
  ],
  upcoming: [
    {
      id: 'epic:next week game',
      storeId: 'epic',
      title: 'Next Week Game',
      kind: 'game',
      storeGameId: 'next-week-game',
      source: 'epic',
      claim: 'unclaimed',
      startsAt: NOW + 4 * 86_400_000
    }
  ],
  fetchedAt: NOW - 3600_000,
  failures: []
}

function stubApi(overrides: Partial<FreebieList> = {}, claim = vi.fn()) {
  const list = { ...LIST, ...overrides }
  const api = {
    getFreebies: vi.fn(async () => list),
    refreshFreebies: vi.fn(async () => list),
    claimFreebie: claim,
    onFreebiesChanged: vi.fn(() => () => {})
  }
  ;(window as unknown as { arcadia: unknown }).arcadia = api
  return api
}

describe('FreeGames', () => {
  beforeEach(() => {
    vi.setSystemTime(NOW)
  })

  it('lists what is free now and what is coming', async () => {
    stubApi()
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    expect(screen.getByText('Skin Pack')).toBeTruthy()
    expect(screen.getByText('Next Week Game')).toBeTruthy()
  })

  it('narrows to games when the Games chip is chosen', async () => {
    stubApi()
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Skin Pack')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Games' }))
    expect(screen.queryByText('Skin Pack')).toBeNull()
    expect(screen.getByText('Ghostrunner')).toBeTruthy()
  })

  it('claims by id, never by address', async () => {
    // The renderer holds a URL for the aggregator rows and must not send
    // it: the address is main's to resolve and validate.
    const claim = vi.fn(async () => ({ ok: true }))
    stubApi({}, claim)
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Skin Pack')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
    expect(claim).toHaveBeenCalledWith('ubisoft:skin pack')
  })

  it('shows the failure of one source above the rest of the list', async () => {
    stubApi({ failures: ["GamerPower's list could not be fetched."] })
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/GamerPower/)).toBeTruthy())
    // The other sources' rows are still there.
    expect(screen.getByText('Ghostrunner')).toBeTruthy()
  })

  it('says how old the list is', async () => {
    stubApi()
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/as of/)).toBeTruthy())
  })

  it('offers an empty state rather than a bare page', async () => {
    stubApi({ current: [], upcoming: [] })
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/Nothing is free to keep/)).toBeTruthy()
    )
  })

  it('does not claim nothing is free when a chip filter is just narrow', async () => {
    // Five Epic games free, DLC chip selected: current/upcoming after the
    // filter are both empty, but that is a fact about the filter, not about
    // the stores. The empty message must not appear on that basis.
    stubApi({
      current: [
        {
          id: 'epic:a',
          storeId: 'epic',
          title: 'A',
          kind: 'game',
          storeGameId: 'a',
          source: 'epic',
          claim: 'unclaimed'
        },
        {
          id: 'epic:b',
          storeId: 'epic',
          title: 'B',
          kind: 'game',
          storeGameId: 'b',
          source: 'epic',
          claim: 'unclaimed'
        }
      ],
      upcoming: []
    })
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'DLC' }))
    expect(screen.queryByText('A')).toBeNull()
    expect(screen.queryByText(/Nothing is free to keep/)).toBeNull()
  })

  it('distinguishes an empty list from an unreachable one', async () => {
    stubApi({
      current: [],
      upcoming: [],
      fetchedAt: undefined,
      failures: ['a', 'b', 'c']
    })
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy())
  })

  it('refetches when the refresh button is pressed', async () => {
    // The button is icon-only now, matching the library toolbar's refresh —
    // "Refresh" lives in aria-label rather than as visible text, so this
    // finds it by accessible name rather than by a text node.
    const api = stubApi()
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.refreshFreebies).toHaveBeenCalled())
  })

  it('closes on the back-to-library button', async () => {
    const onClose = vi.fn()
    stubApi()
    render(<FreeGames onClose={onClose} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Back to library/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('reaches the configuration screen through the gear, same as the library toolbar', async () => {
    // The page covers the toolbar while it is open, so the gear has to be
    // reachable from here too, not just from the library behind it.
    const onOpenSetup = vi.fn()
    stubApi()
    render(<FreeGames onClose={vi.fn()} onOpenSetup={onOpenSetup} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configuration…' }))
    expect(onOpenSetup).toHaveBeenCalled()
  })

  it('shows an error banner when a claim fails rather than confirming it', async () => {
    const claim = vi.fn(async () => ({ ok: false, error: 'The offer has already ended.' }))
    stubApi({}, claim)
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Skin Pack')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('The offer has already ended.')
    )
  })

  it('reloads the list when the main process reports a change', async () => {
    // The main process refreshes behind the first answer and confirms
    // claims after a scan; both arrive as this event, not as a direct
    // response to anything the renderer did.
    let notify: (() => void) | undefined
    const list = { ...LIST }
    const api = {
      getFreebies: vi.fn(async () => list),
      refreshFreebies: vi.fn(async () => list),
      claimFreebie: vi.fn(),
      onFreebiesChanged: vi.fn((callback: () => void) => {
        notify = callback
        return () => {}
      })
    }
    ;(window as unknown as { arcadia: unknown }).arcadia = api
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    expect(api.getFreebies).toHaveBeenCalledTimes(1)

    notify?.()

    await waitFor(() => expect(api.getFreebies).toHaveBeenCalledTimes(2))
  })

  it('shows the thrown error rather than a blank page when the initial load rejects', async () => {
    const api = {
      getFreebies: vi.fn(async () => {
        throw new Error('Database is locked')
      }),
      refreshFreebies: vi.fn(async () => LIST),
      claimFreebie: vi.fn(),
      onFreebiesChanged: vi.fn(() => () => {})
    }
    ;(window as unknown as { arcadia: unknown }).arcadia = api
    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Database is locked')
    )
    // The error already explains the blank page; the empty message would
    // contradict it by offering a second, different reason.
    expect(screen.queryByText(/Nothing is free to keep/)).toBeNull()
  })

  it('lets the newer of two in-flight loads win, even if it resolves first', async () => {
    // The mount effect starts a load; onFreebiesChanged can start another
    // before the first settles. If the older one resolves last, it must not
    // overwrite the newer answer.
    let resolveSlow: ((value: FreebieList) => void) | undefined
    const slow = new Promise<FreebieList>((resolve) => {
      resolveSlow = resolve
    })
    const fastList: FreebieList = {
      ...LIST,
      current: [
        {
          id: 'epic:fresh-arrival',
          storeId: 'epic',
          title: 'Fresh Arrival',
          kind: 'game',
          storeGameId: 'fresh-arrival',
          source: 'epic',
          claim: 'unclaimed',
          endsAt: NOW + 2 * 86_400_000
        }
      ]
    }
    let notify: (() => void) | undefined
    let getFreebiesCalls = 0
    const api = {
      getFreebies: vi.fn(() => {
        getFreebiesCalls += 1
        // First call (mount) is the slow, stale one; the second call
        // (triggered below) resolves immediately with fresher data.
        return getFreebiesCalls === 1 ? slow : Promise.resolve(fastList)
      }),
      refreshFreebies: vi.fn(async () => LIST),
      claimFreebie: vi.fn(),
      onFreebiesChanged: vi.fn((callback: () => void) => {
        notify = callback
        return () => {}
      })
    }
    ;(window as unknown as { arcadia: unknown }).arcadia = api

    render(<FreeGames onClose={vi.fn()} onOpenSetup={vi.fn()} />)
    await waitFor(() => expect(api.getFreebies).toHaveBeenCalledTimes(1))

    // Start the second, faster load while the first is still pending.
    notify?.()
    await waitFor(() => expect(api.getFreebies).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('Fresh Arrival')).toBeTruthy())

    // Now let the slow, older load settle with the stale list.
    resolveSlow?.(LIST)
    await waitFor(() => expect(screen.getByText('Fresh Arrival')).toBeTruthy())
    expect(screen.queryByText('Ghostrunner')).toBeNull()
  })
})
