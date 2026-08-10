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
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    expect(screen.getByText('Skin Pack')).toBeTruthy()
    expect(screen.getByText('Next Week Game')).toBeTruthy()
  })

  it('narrows to games when the Games chip is chosen', async () => {
    stubApi()
    render(<FreeGames onClose={vi.fn()} />)
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
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Skin Pack')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
    expect(claim).toHaveBeenCalledWith('ubisoft:skin pack')
  })

  it('shows the failure of one source above the rest of the list', async () => {
    stubApi({ failures: ["GamerPower's list could not be fetched."] })
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/GamerPower/)).toBeTruthy())
    // The other sources' rows are still there.
    expect(screen.getByText('Ghostrunner')).toBeTruthy()
  })

  it('says how old the list is', async () => {
    stubApi()
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/as of/)).toBeTruthy())
  })

  it('offers an empty state rather than a bare page', async () => {
    stubApi({ current: [], upcoming: [] })
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/Nothing is free to keep/)).toBeTruthy()
    )
  })

  it('distinguishes an empty list from an unreachable one', async () => {
    stubApi({
      current: [],
      upcoming: [],
      fetchedAt: undefined,
      failures: ['a', 'b', 'c']
    })
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy())
  })

  it('refetches when the refresh button is pressed', async () => {
    const api = stubApi()
    render(<FreeGames onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.refreshFreebies).toHaveBeenCalled())
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    stubApi()
    render(<FreeGames onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Ghostrunner')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error banner when a claim fails rather than confirming it', async () => {
    const claim = vi.fn(async () => ({ ok: false, error: 'The offer has already ended.' }))
    stubApi({}, claim)
    render(<FreeGames onClose={vi.fn()} />)
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
    render(<FreeGames onClose={vi.fn()} />)
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
    render(<FreeGames onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Database is locked')
    )
  })
})
