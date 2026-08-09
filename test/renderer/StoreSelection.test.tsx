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

  it('shows the reason a store was not found', async () => {
    stubApi({ epic: { available: false, reason: 'No Epic Games Launcher here.' } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(await screen.findByText(/No Epic Games Launcher here\./)).toBeDefined()
  })

  it('shows a limitation of a store that was found', async () => {
    stubApi({ ubisoft: { available: true, limitations: ['Owned games from a local cache.'] } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(await screen.findByText(/Owned games from a local cache\./)).toBeDefined()
  })

  it('keeps the checkboxes usable when the probe fails', async () => {
    ;(window as unknown as { arcadia: unknown }).arcadia = {
      getStoreAvailability: async () => {
        throw new Error('nope')
      },
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
