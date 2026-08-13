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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddGameDialog } from '@renderer/components/AddGameDialog'
import { stubArcadia } from './fixtures'
import { STORE_IDS } from '@shared/types'
import { t } from '@shared/i18n'
import type { ArcadiaApi } from '@shared/ipc'

/** So `.mock.calls[0][0]` is typed as the payload rather than `never`. */
type AddManualGamePayload = Parameters<ArcadiaApi['addManualGame']>[0]

/** Stands in for `onClose`/`onAdded` where a test does not check either. */
const noop = (): void => undefined

/**
 * Matches a label's accessible name by its start.
 *
 * Mirrors the fix already used above for the store-identifier field: a
 * `<label>` here wraps the field name and its sublabel hint together, so the
 * accessible name is the two run on with nothing between them. Anchoring on
 * the start finds the input without a production change.
 */
const startingWith = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

describe('AddGameDialog', () => {
  it('sends the name and store, omitting an empty store ID', async () => {
    const addManualGame = vi.fn(
      async (_payload: AddManualGamePayload) => ({ ok: true, id: 'steam:manual-1' })
    )
    stubArcadia({ addManualGame })
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={onAdded} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('steam:manual-7'))
  })

  it('does not submit an empty name', () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={onClose} onAdded={vi.fn()} />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(addManualGame).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    stubArcadia()
    const onClose = vi.fn()
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={onClose} onAdded={vi.fn()} />)

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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })

    await waitFor(() => expect(addManualGame).toHaveBeenCalledOnce())
  })

  // A second, independent handler on the store ID field - checked separately
  // rather than assumed identical to the name field's.
  it('submits on Enter in the store ID field', async () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.keyDown(screen.getByLabelText(/^Store ID \(optional\)/), { key: 'Enter' })

    await waitFor(() => expect(addManualGame).toHaveBeenCalledOnce())
  })

  /**
   * A game filed under a switched-off store is written and then filtered
   * straight back out of the visible library: removal is only reachable
   * from a grid row, so there is none to click, and adding it again fails
   * as a duplicate. An unreachable row with no error and no route back.
   */
  it('offers only the stores that are switched on', () => {
    stubArcadia()
    render(
      <AddGameDialog availableStores={['steam', 'epic']} onClose={vi.fn()} onAdded={vi.fn()} />
    )

    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
      'steam',
      'epic'
    ])
  })

  it('files the game under an enabled store when the usual default is off', () => {
    // EA is the store this dialog exists for, but it cannot be the default
    // when the user has switched it off.
    const addManualGame = vi.fn(async (_payload: AddManualGamePayload) => ({
      ok: true,
      id: 'steam:manual-1'
    }))
    stubArcadia({ addManualGame })
    render(
      <AddGameDialog availableStores={['steam', 'epic']} onClose={vi.fn()} onAdded={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    return waitFor(() => expect(addManualGame.mock.calls[0]![0].storeId).toBe('steam'))
  })

  it('files the game under the store picked from the list', async () => {
    // Also pins that switching the store re-runs the identifier check: EA
    // takes digits only, Epic does not, so an id valid for one is not
    // silently carried over as valid for the other.
    const addManualGame = vi.fn(async (_payload: AddManualGamePayload) => ({
      ok: true,
      id: 'epic:manual-1'
    }))
    stubArcadia({ addManualGame })
    render(
      <AddGameDialog availableStores={['ea', 'epic']} onClose={vi.fn()} onAdded={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'epic' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(addManualGame.mock.calls[0]![0].storeId).toBe('epic'))
  })

  it('says so, and adds nothing, when every store is switched off', () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'x' }))
    stubArcadia({ addManualGame })
    render(<AddGameDialog availableStores={[]} onClose={vi.fn()} onAdded={vi.fn()} />)

    expect(screen.getByText(/No store is switched on/)).toBeDefined()
    expect(screen.queryByRole('combobox')).toBeNull()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    expect(addManualGame).not.toHaveBeenCalled()
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
    render(<AddGameDialog availableStores={[...STORE_IDS]} onClose={vi.fn()} onAdded={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A Game' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(screen.getByText('Disk full')).toBeDefined())
  })
})

describe('a storeless game', () => {
  it('offers a program instead of a store identifier', () => {
    stubArcadia()
    render(<AddGameDialog availableStores={['steam', 'other']} onClose={noop} onAdded={noop} />)

    fireEvent.change(screen.getByLabelText(t().addDialog.storeLabel), {
      target: { value: 'other' }
    })

    expect(screen.getByText(t().addDialog.executableLabel)).toBeTruthy()
    expect(screen.queryByText(t().addDialog.idLabel)).toBeNull()
  })

  it('fills the name in from the program when the field is still empty', async () => {
    stubArcadia({
      pickExecutable: async () => ({
        ok: true,
        exe: 'C:\\Games\\mc.exe',
        args: ['--offline'],
        suggestedName: 'Minecraft Launcher'
      })
    })
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    fireEvent.click(screen.getByRole('button', { name: t().addDialog.browse }))

    await waitFor(() =>
      expect((screen.getByLabelText(t().addDialog.nameLabel) as HTMLInputElement).value).toBe(
        'Minecraft Launcher'
      )
    )
    expect(
      (screen.getByLabelText(startingWith(t().addDialog.argumentsLabel)) as HTMLInputElement)
        .value
    ).toBe('--offline')
  })

  it('leaves a name the user typed alone', async () => {
    stubArcadia({
      pickExecutable: async () => ({
        ok: true,
        exe: 'C:\\Games\\mc.exe',
        args: [],
        suggestedName: 'mc'
      })
    })
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    fireEvent.change(screen.getByLabelText(t().addDialog.nameLabel), {
      target: { value: 'My Modpack' }
    })
    fireEvent.click(screen.getByRole('button', { name: t().addDialog.browse }))

    // Waits on the executable path landing rather than on the name, which is
    // expected not to move: without a signal that browse() has actually
    // finished, this assertion could pass before the async pick resolves,
    // for the wrong reason.
    await waitFor(() => expect(screen.getByText('C:\\Games\\mc.exe')).toBeDefined())
    expect((screen.getByLabelText(t().addDialog.nameLabel) as HTMLInputElement).value).toBe(
      'My Modpack'
    )
  })

  it('cannot be submitted without a program', () => {
    stubArcadia()
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    fireEvent.change(screen.getByLabelText(t().addDialog.nameLabel), {
      target: { value: 'Minecraft' }
    })

    expect(
      (screen.getByRole('button', { name: t().addDialog.submit }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('sends the program and the arguments', async () => {
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'other:manual-minecraft' }))
    stubArcadia({
      addManualGame,
      pickExecutable: async () => ({
        ok: true,
        exe: 'C:\\Games\\mc.exe',
        args: [],
        suggestedName: 'Minecraft'
      })
    })
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    fireEvent.click(screen.getByRole('button', { name: t().addDialog.browse }))
    // The submit button stays disabled until exe is set, so the pick has to
    // land before the arguments can be typed and Add clicked.
    await waitFor(() => expect(screen.getByText('C:\\Games\\mc.exe')).toBeDefined())

    fireEvent.change(screen.getByLabelText(startingWith(t().addDialog.argumentsLabel)), {
      target: { value: '--profile "My Pack"' }
    })
    fireEvent.click(screen.getByRole('button', { name: t().addDialog.submit }))

    await waitFor(() =>
      expect(addManualGame).toHaveBeenCalledWith({
        storeId: 'other',
        name: 'Minecraft',
        launchExe: 'C:\\Games\\mc.exe',
        launchArgs: ['--profile', 'My Pack']
      })
    )
  })

  it('re-quotes a picked argument that contains a space, and splits it back on submit', async () => {
    // This is what a resolved Windows shortcut produces: an argument such as
    // a profile name can contain a space, so it has to survive the round
    // trip through the display field's plain-text quoting and back through
    // parseArguments() as one argument, not two.
    const addManualGame = vi.fn(async () => ({ ok: true, id: 'other:manual-modpack' }))
    stubArcadia({
      addManualGame,
      pickExecutable: async () => ({
        ok: true,
        exe: 'C:\\Games\\mc.exe',
        args: ['--profile', 'My Pack'],
        suggestedName: 'Minecraft'
      })
    })
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    fireEvent.click(screen.getByRole('button', { name: t().addDialog.browse }))

    await waitFor(() =>
      expect(
        (screen.getByLabelText(startingWith(t().addDialog.argumentsLabel)) as HTMLInputElement)
          .value
      ).toBe('--profile "My Pack"')
    )

    fireEvent.click(screen.getByRole('button', { name: t().addDialog.submit }))

    await waitFor(() =>
      expect(addManualGame).toHaveBeenCalledWith({
        storeId: 'other',
        name: 'Minecraft',
        launchExe: 'C:\\Games\\mc.exe',
        launchArgs: ['--profile', 'My Pack']
      })
    )
  })

  it('shows why a chosen file was refused', async () => {
    stubArcadia({ pickExecutable: async () => ({ ok: false, error: 'Not a program.' }) })
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    fireEvent.click(screen.getByRole('button', { name: t().addDialog.browse }))

    await waitFor(() => expect(screen.getByText('Not a program.')).toBeTruthy())
  })

  it('says nothing when the dialog was simply closed', async () => {
    stubArcadia({ pickExecutable: async () => ({ ok: false }) })
    render(<AddGameDialog availableStores={['other']} onClose={noop} onAdded={noop} />)

    // Nothing observable changes on this path (no error, no exe), so there
    // is no state to waitFor on. `act` flushes the async pick to completion
    // before the assertion runs instead.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t().addDialog.browse }))
    })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
