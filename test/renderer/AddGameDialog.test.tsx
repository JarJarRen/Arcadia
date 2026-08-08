/**
 * Adding a game by hand.
 *
 * Exists for the games no adapter can see — EA only lists what has been
 * installed on this machine. The store ID is optional on purpose: without
 * it the entry still gets artwork and a description through the usual Steam
 * matching, it just cannot be launched. That distinction is what the
 * payload tests pin.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddGameDialog } from '@renderer/components/AddGameDialog'
import { stubArcadia } from './fixtures'
import type { ArcadiaApi } from '@shared/ipc'

/** So `.mock.calls[0][0]` is typed as the payload rather than `never`. */
type AddManualGamePayload = Parameters<ArcadiaApi['addManualGame']>[0]

describe('AddGameDialog', () => {
  it('sends the name and store, omitting an empty store ID', async () => {
    const addManualGame = vi.fn(
      async (_payload: AddManualGamePayload) => ({ ok: true, id: 'steam:manual-1' })
    )
    stubArcadia({ addManualGame })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(addManualGame).toHaveBeenCalledOnce())
    const payload = addManualGame.mock.calls[0]![0]
    expect(payload.name).toBe('A Game')
    expect(payload.storeGameId).toBeUndefined()
  })

  it('sends the store ID when one was given', async () => {
    const addManualGame = vi.fn(
      async (_payload: AddManualGamePayload) => ({ ok: true, id: 'steam:440' })
    )
    stubArcadia({ addManualGame })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TF2' } })
    // The brief's exact string 'Store ID (optional)' does not match: the
    // label wraps not just the field name but its sublabel hint too, so the
    // input's accessible name is the two run together. A regex anchored on
    // the start finds it without a production change.
    fireEvent.change(screen.getByLabelText(/^Store ID \(optional\)/), {
      target: { value: '440' }
    })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(addManualGame).toHaveBeenCalledOnce())
    const payload = addManualGame.mock.calls[0]![0]
    expect(payload.storeGameId).toBe('440')
  })

  it('hands the new id back so the caller can select it', async () => {
    stubArcadia({ addManualGame: async () => ({ ok: true, id: 'steam:manual-7' }) })
    const onAdded = vi.fn()
    render(<AddGameDialog onClose={vi.fn()} onAdded={onAdded} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('steam:manual-7'))
  })

  it('does not submit an empty name', () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.click(screen.getByText('Add'))

    expect(addManualGame).not.toHaveBeenCalled()
  })

  it('shows the reason a rejected entry was rejected', async () => {
    // The message carries what the user needs — a duplicate, an empty name,
    // an identifier of the wrong shape — so it is passed on rather than
    // replaced with something generic.
    stubArcadia({
      addManualGame: async () => ({ ok: false, error: 'A game with this name already exists.' })
    })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TF2' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() =>
      expect(screen.getByText(/already exists/)).toBeDefined()
    )
  })

  it('closes on cancel without adding anything', () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    const onClose = vi.fn()
    render(<AddGameDialog onClose={onClose} onAdded={vi.fn()} />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(addManualGame).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    stubArcadia()
    const onClose = vi.fn()
    render(<AddGameDialog onClose={onClose} onAdded={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  // The default store is EA, whose identifiers are digits only
  // (storeGameIdLooksValid in src/shared/manual.ts). Paired with 'sends the
  // store ID when one was given' above, which exercises a well-formed id,
  // this pins the predicate itself rather than just the disabled attribute.
  it('blocks submission when the store ID does not look valid for the selected store', () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.change(screen.getByLabelText(/^Store ID \(optional\)/), {
      target: { value: 'not-a-number' }
    })

    expect(screen.getByText('Invalid input.')).toBeDefined()

    fireEvent.click(screen.getByText('Add'))

    expect(addManualGame).not.toHaveBeenCalled()
  })

  it('submits on Enter in the name field', async () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })

    await waitFor(() => expect(addManualGame).toHaveBeenCalledOnce())
  })

  // A second, independent handler on the store ID field - checked separately
  // rather than assumed identical to the name field's.
  it('submits on Enter in the store ID field', async () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.keyDown(screen.getByLabelText(/^Store ID \(optional\)/), { key: 'Enter' })

    await waitFor(() => expect(addManualGame).toHaveBeenCalledOnce())
  })

  it('shows the thrown error message when adding a game rejects', async () => {
    // Distinct from 'shows the reason a rejected entry was rejected' above,
    // which covers addManualGame resolving with { ok: false }. This is the
    // thrown-error path, caught separately in the component's submit().
    stubArcadia({
      addManualGame: async () => {
        throw new Error('Disk full')
      }
    })
    render(<AddGameDialog onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(screen.getByText('Disk full')).toBeDefined())
  })
})
