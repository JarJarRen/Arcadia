import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LaunchResult } from '@shared/ipc'
import { InstallOverlay, OVERLAY_DELAY_MS } from '@renderer/components/InstallOverlay'
import { App } from '@renderer/App'
import { entry, game, stubArcadia } from './fixtures'

/**
 * A game that is not installed, which is what puts an Install button on
 * the card — an installed one shows Play instead.
 */
function uninstalled(): ReturnType<typeof entry> {
  return entry('Portal', [game('steam', '400', 'Portal', { installed: false })])
}

describe('InstallOverlay', () => {
  it('names the store it is waiting for', () => {
    render(<InstallOverlay store="Steam" onDismiss={() => undefined} />)
    expect(screen.getByRole('status').textContent).toContain('Steam')
  })

  it('dismisses on Escape', () => {
    let dismissed = 0
    render(<InstallOverlay store="Steam" onDismiss={() => (dismissed += 1)} />)

    // useDismiss listens on the document, not on the box.
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(dismissed).toBe(1)
  })

  it('dismisses on a press outside the box', () => {
    let dismissed = 0
    const { container } = render(
      <InstallOverlay store="Steam" onDismiss={() => (dismissed += 1)} />
    )

    // mousedown rather than click: that is what useDismiss listens for, so
    // the overlay is gone before whatever is underneath reacts.
    fireEvent.mouseDown(container.querySelector('.modal') as Element)

    expect(dismissed).toBe(1)
  })

  it('stays open on a press inside the box', () => {
    let dismissed = 0
    const { container } = render(
      <InstallOverlay store="Steam" onDismiss={() => (dismissed += 1)} />
    )

    fireEvent.mouseDown(container.querySelector('.modal__box') as Element)

    expect(dismissed).toBe(0)
  })
})

/**
 * Renders the app and returns its Install button.
 *
 * The library arrives through a promise, so the button does not exist on
 * the first frame. Fake timers are installed only after this has settled —
 * `findByRole` polls on timers of its own, and mixing the two is a source
 * of hangs that have nothing to do with what is under test.
 */
async function renderWithInstallButton(): Promise<HTMLElement> {
  render(<App />)
  return screen.findByRole('button', { name: 'Install' })
}

describe('App install overlay', () => {
  it('stays hidden while the answer comes back quickly', async () => {
    // Steam already running, or a platform without the window agent. A
    // flash of overlay would be worse than none.
    stubArcadia({
      getGames: async () => [uninstalled()],
      install: async () => ({ ok: true })
    })
    const button = await renderWithInstallButton()

    fireEvent.click(button)

    // The delay is real time and 250 ms have not passed, so nothing shows.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('appears once the wait passes the delay, and clears on the answer', async () => {
    let finish: ((value: LaunchResult) => void) | undefined
    stubArcadia({
      getGames: async () => [uninstalled()],
      install: () =>
        new Promise<LaunchResult>((resolve) => {
          finish = resolve
        })
    })
    const button = await renderWithInstallButton()

    vi.useFakeTimers()
    fireEvent.click(button)
    act(() => {
      vi.advanceTimersByTime(OVERLAY_DELAY_MS + 50)
    })

    expect(screen.getByRole('status')).toBeTruthy()

    vi.useRealTimers()
    await act(async () => {
      finish?.({ ok: true })
    })

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('cancels the assist when dismissed, without swallowing the answer', async () => {
    let cancels = 0
    let finish: ((value: LaunchResult) => void) | undefined
    stubArcadia({
      getGames: async () => [uninstalled()],
      install: () =>
        new Promise<LaunchResult>((resolve) => {
          finish = resolve
        }),
      cancelInstall: async () => {
        cancels += 1
      }
    })
    const button = await renderWithInstallButton()

    vi.useFakeTimers()
    fireEvent.click(button)
    act(() => {
      vi.advanceTimersByTime(OVERLAY_DELAY_MS + 50)
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(cancels).toBe(1)
    expect(screen.queryByRole('status')).toBeNull()

    // The install itself was never cancelled, so its answer still arrives.
    // A failure in it has to reach the user even though the overlay is
    // long gone — dismissing the waiting must not dismiss the outcome.
    vi.useRealTimers()
    await act(async () => {
      finish?.({ ok: false, error: 'Install exploded.' })
    })

    expect(await screen.findByText('Install exploded.')).toBeTruthy()
  })

  it('shows the timeout notice as a banner', async () => {
    stubArcadia({
      getGames: async () => [uninstalled()],
      install: async () => ({ ok: true, notice: 'Steam did not open an install dialog.' })
    })
    const button = await renderWithInstallButton()

    fireEvent.click(button)

    expect(await screen.findByText(/Steam did not open an install dialog/)).toBeTruthy()
  })

  it('does not close a newer overlay when an older install answers first', async () => {
    const resolvers: Array<(value: LaunchResult) => void> = []
    stubArcadia({
      getGames: async () => [uninstalled()],
      install: () =>
        new Promise<LaunchResult>((resolve) => {
          resolvers.push(resolve)
        })
    })
    const button = await renderWithInstallButton()

    vi.useFakeTimers()
    fireEvent.click(button)
    act(() => {
      vi.advanceTimersByTime(OVERLAY_DELAY_MS + 50)
    })
    expect(screen.getByRole('status')).toBeTruthy()

    // A second install starts while the first is still waiting. Its own
    // delay timer never gets a chance to fire — real timers come back
    // before that — so what stays on screen is still install #1's overlay.
    // What does change is the sequence number the guard compares against.
    fireEvent.click(button)

    vi.useRealTimers()
    await act(async () => {
      resolvers[0]?.({ ok: true })
    })

    // Still install #1's overlay, never having been replaced — but its
    // answer no longer matches the current sequence, so the guard must
    // treat the clear as stale and leave what's on screen alone.
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('still reports an error from a superseded install', async () => {
    const resolvers: Array<(value: LaunchResult) => void> = []
    stubArcadia({
      getGames: async () => [uninstalled()],
      install: () =>
        new Promise<LaunchResult>((resolve) => {
          resolvers.push(resolve)
        })
    })
    const button = await renderWithInstallButton()

    vi.useFakeTimers()
    fireEvent.click(button)
    act(() => {
      vi.advanceTimersByTime(OVERLAY_DELAY_MS + 50)
    })
    expect(screen.getByRole('status')).toBeTruthy()

    // A second install starts while the first is still waiting.
    fireEvent.click(button)

    vi.useRealTimers()
    await act(async () => {
      resolvers[0]?.({ ok: false, error: 'Install exploded.' })
    })

    // The first install's error must still reach the user, even though it
    // no longer owns the overlay.
    expect(await screen.findByText('Install exploded.')).toBeTruthy()
  })
})
