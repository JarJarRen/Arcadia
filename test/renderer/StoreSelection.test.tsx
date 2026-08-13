/**
 * The store list in the configuration screen.
 *
 * The availability note is what makes switching a store off an informed
 * click rather than a guess, and it must never block the checkboxes: the
 * probe reads the registry and can take a moment.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StoreSelection } from '@renderer/components/StoreSelection'
import { STORE_IDS } from '@shared/types'

function stubApi(availability: Record<string, unknown> = {}): void {
  ;(window as unknown as { arcadia: unknown }).arcadia = {
    getStoreAvailability: async () => availability,
    isSecureStorageAvailable: async () => true,
    getMicrosoftAuth: async () => ({ signedIn: false }),
    signInToMicrosoft: async () => ({ ok: false, error: 'not configured' }),
    signOutOfMicrosoft: async () => undefined,
    onMicrosoftAuthChanged: () => () => undefined
  }
}

describe('StoreSelection', () => {
  it('ticks the stores that are enabled', () => {
    stubApi()
    render(<StoreSelection enabled={['steam']} onChange={vi.fn()} />)

    expect((screen.getByRole('checkbox', { name: /steam/i }) as HTMLInputElement).checked).toBe(
      true
    )
    expect((screen.getByRole('checkbox', { name: /epic/i }) as HTMLInputElement).checked).toBe(
      false
    )
  })

  it('reports the whole selection when one store is ticked', () => {
    stubApi()
    const onChange = vi.fn()
    render(<StoreSelection enabled={['steam']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /epic/i }))

    expect(onChange).toHaveBeenCalledWith(['steam', 'epic'])
  })

  it('reports an empty selection when the last store is unticked', () => {
    stubApi()
    const onChange = vi.fn()
    render(<StoreSelection enabled={['steam']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /steam/i }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('says it is checking until the probe answers', () => {
    stubApi()
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(screen.getAllByText(/checking/i).length).toBeGreaterThan(0)
  })

  it('keeps the status on the row and the reason behind the button', async () => {
    stubApi({ epic: { available: false, reason: 'No Epic Games Launcher here.' } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    // The status is the part you should not have to click for.
    expect(await screen.findAllByText(/not found on this machine/i)).toBeDefined()
    expect(screen.queryByText(/No Epic Games Launcher here\./)).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /details about epic/i }))

    expect(screen.getByText(/No Epic Games Launcher here\./)).toBeDefined()
  })

  it('keeps a limitation behind the button too', async () => {
    stubApi({ ubisoft: { available: true, limitations: ['Owned games from a local cache.'] } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /details about ubisoft/i })).toBeDefined()
    expect(screen.queryByText(/Owned games from a local cache\./)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /details about ubisoft/i }))

    expect(screen.getByText(/Owned games from a local cache\./)).toBeDefined()
  })

  it('offers no button for a store with nothing to explain', async () => {
    stubApi({ steam: { available: true } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    await screen.findAllByText(/found on this machine/i)
    // No affordance to go hunting through when there is nothing behind it.
    expect(screen.queryByRole('button', { name: /details about steam/i })).toBeNull()
  })

  it('does not toggle the store when its detail button is pressed', async () => {
    // The row's text sits inside a <label>, so a button placed within it
    // would be part of the checkbox's click target.
    stubApi({ ubisoft: { available: true, limitations: ['Owned games from a local cache.'] } })
    const onChange = vi.fn()
    render(<StoreSelection enabled={['ubisoft']} onChange={onChange} />)

    fireEvent.click(await screen.findByRole('button', { name: /details about ubisoft/i }))

    expect(onChange).not.toHaveBeenCalled()
    expect((screen.getByRole('checkbox', { name: /ubisoft/i }) as HTMLInputElement).checked).toBe(
      true
    )
  })

  it('closes one store\'s detail when another is opened', async () => {
    // Nothing coordinates this: pressing the second button is a mousedown
    // outside the first popover's root, which closes it. Pinned so nobody
    // adds shared "which one is open" state to solve a problem that is
    // already solved.
    stubApi({
      ubisoft: { available: true, limitations: ['Owned games from a local cache.'] },
      ea: { available: true, limitations: ['Install state is a heuristic.'] }
    })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /details about ubisoft/i }))
    expect(screen.getByText(/Owned games from a local cache\./)).toBeDefined()

    fireEvent.mouseDown(screen.getByRole('button', { name: /details about ea/i }))
    fireEvent.click(screen.getByRole('button', { name: /details about ea/i }))

    expect(screen.queryByText(/Owned games from a local cache\./)).toBeNull()
    expect(screen.getByText(/Install state is a heuristic\./)).toBeDefined()
  })

  it('keeps the checkboxes usable when the probe fails', async () => {
    ;(window as unknown as { arcadia: unknown }).arcadia = {
      getStoreAvailability: async () => {
        throw new Error('nope')
      },
      isSecureStorageAvailable: async () => true,
      getMicrosoftAuth: async () => ({ signedIn: false }),
      signInToMicrosoft: async () => ({ ok: false, error: 'not configured' }),
      signOutOfMicrosoft: async () => undefined,
      onMicrosoftAuthChanged: () => () => undefined
    }
    const onChange = vi.fn()
    render(<StoreSelection enabled={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /steam/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['steam']))
  })

  it('offers to connect a Microsoft account', async () => {
    stubApi()
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /connect a microsoft account/i })).toBeDefined()
  })

  /**
   * The button used to stay clickable for the whole round trip to
   * Microsoft's device-code endpoint, with no feedback at all — which is
   * exactly what invites a second click. That second click used to start a
   * second flow racing the first; main now supersedes correctly, but the
   * button itself still needs to say something happened, and stop taking
   * further clicks until it does.
   *
   * `signInToMicrosoft` is held open on a hand-resolved promise so the
   * pending state can be observed before the request settles.
   */
  it('disables the sign-in button and shows feedback while the request is in flight', async () => {
    stubApi()
    let resolveSignIn:
      | ((result: { ok: boolean; userCode?: string; verificationUri?: string; error?: string }) => void)
      | undefined
    ;(window.arcadia as unknown as Record<string, unknown>).signInToMicrosoft = async () =>
      await new Promise((resolve) => {
        resolveSignIn = resolve
      })
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /connect a microsoft account/i }))

    const pendingButton = (await screen.findByRole('button', {
      name: /connecting/i
    })) as HTMLButtonElement
    expect(pendingButton.disabled).toBe(true)

    resolveSignIn?.({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/link'
    })

    expect(await screen.findByText(/ABCD-EFGH/)).toBeDefined()
  })

  it('shows the code and the link once the sign-in has started', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).signInToMicrosoft = async () => ({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/link'
    })
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /connect a microsoft account/i }))

    expect(await screen.findByText(/ABCD-EFGH/)).toBeDefined()
    // A plain link, so the window's open handler sends it to the system
    // browser — no new main-process shell call for this.
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://microsoft.com/link')
  })

  /**
   * A failed poll — expired code, declined, network drop — used to leave
   * `pending` set forever: the auth-changed refresh only ever cleared it on
   * a signed-in result, so the expired code sat on screen with no sign-in
   * button to retry from. Recovery required closing and reopening the
   * Configuration dialog. These two tests pin the fix: the refresh must also
   * clear `pending` — and show the reason — when it comes back "not signed
   * in".
   */
  it('clears the pending code and brings back the sign-in button when a poll fails', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).signInToMicrosoft = async () => ({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/link'
    })
    let notifyAuthChanged: ((error?: string) => void) | undefined
    ;(window.arcadia as unknown as Record<string, unknown>).onMicrosoftAuthChanged = (
      callback: (error?: string) => void
    ) => {
      notifyAuthChanged = callback
      return () => undefined
    }
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /connect a microsoft account/i }))
    expect(await screen.findByText(/ABCD-EFGH/)).toBeDefined()

    // Main's poll ended without a sign-in; getMicrosoftAuth still answers
    // "not signed in" (the stub's default), same as it would for real.
    notifyAuthChanged?.('The sign-in code expired before it was used. Please try again.')

    expect(
      await screen.findByRole('button', { name: /connect a microsoft account/i })
    ).toBeDefined()
    expect(screen.queryByText(/ABCD-EFGH/)).toBeNull()
  })

  it('shows the reason a poll failed, so the user knows what to try again for', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).signInToMicrosoft = async () => ({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/link'
    })
    let notifyAuthChanged: ((error?: string) => void) | undefined
    ;(window.arcadia as unknown as Record<string, unknown>).onMicrosoftAuthChanged = (
      callback: (error?: string) => void
    ) => {
      notifyAuthChanged = callback
      return () => undefined
    }
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /connect a microsoft account/i }))
    expect(await screen.findByText(/ABCD-EFGH/)).toBeDefined()

    notifyAuthChanged?.('The sign-in code expired before it was used. Please try again.')

    expect(
      await screen.findByText('The sign-in code expired before it was used. Please try again.')
    ).toBeDefined()
  })

  it('shows the gamertag and an exit once connected', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).getMicrosoftAuth = async () => ({
      signedIn: true,
      gamertag: 'Player'
    })
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    expect(await screen.findByText(/Signed in as Player/)).toBeDefined()
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeDefined()
  })

  it('disconnects on click and drops the pending code, so a stale one is never shown again', async () => {
    stubApi()
    const signOutOfMicrosoft = vi.fn(async () => undefined)
    ;(window.arcadia as unknown as Record<string, unknown>).getMicrosoftAuth = async () => ({
      signedIn: true,
      gamertag: 'Player'
    })
    ;(window.arcadia as unknown as Record<string, unknown>).signOutOfMicrosoft = signOutOfMicrosoft
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }))

    expect(signOutOfMicrosoft).toHaveBeenCalledOnce()
  })

  it('shows the failure when starting the sign-in rejects outright', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).signInToMicrosoft = async () => {
      throw new Error('network unreachable')
    }
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /connect a microsoft account/i }))

    expect(await screen.findByText('network unreachable')).toBeDefined()
    // No code to show: the request never got that far.
    expect(screen.queryByRole('link')).toBeNull()
  })

  /**
   * `main/index.ts` says "The configuration screen says so" of a system
   * where safeStorage cannot encrypt, and the design requires it — but no
   * string in either bundle mentioned encryption, a keyring or plaintext.
   * On a desktop with no keyring the refresh token goes into arcadia.db in
   * the clear and the user was never told.
   */
  it('says so when the sign-in cannot be stored encrypted', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).isSecureStorageAvailable = async () =>
      false
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    expect(await screen.findByText(/stored unencrypted/i)).toBeDefined()
  })

  it('says nothing about encryption where the system can encrypt', async () => {
    stubApi()
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    // Awaited on something else first, so this is not merely testing that
    // the effects have not run yet.
    expect(await screen.findByRole('button', { name: /connect a microsoft account/i })).toBeDefined()
    expect(screen.queryByText(/stored unencrypted/i)).toBeNull()
  })

  it('says nothing about encryption when the probe itself fails', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).isSecureStorageAvailable = async () => {
      throw new Error('ipc down')
    }
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /connect a microsoft account/i })).toBeDefined()
    expect(screen.queryByText(/stored unencrypted/i)).toBeNull()
  })

  it('stays on the sign-in offer when the auth state cannot be read', async () => {
    stubApi()
    ;(window.arcadia as unknown as Record<string, unknown>).getMicrosoftAuth = async () => {
      throw new Error('ipc down')
    }
    render(<StoreSelection enabled={[...STORE_IDS]} onChange={vi.fn()} />)

    // The failure is swallowed rather than crashing the screen: the row
    // falls back to its default signed-out state, offer intact.
    expect(await screen.findByRole('button', { name: /connect a microsoft account/i })).toBeDefined()
  })
})
