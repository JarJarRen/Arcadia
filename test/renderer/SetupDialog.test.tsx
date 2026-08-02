/**
 * The API key configuration screen.
 *
 * The brief for this component gave contracts rather than code, so the
 * shape below comes from reading SetupDialog.tsx directly rather than from
 * the brief's description. One contract did not match what is actually
 * there: the brief frames the "skip" control as gated by `firstRun`, but
 * the skip checkbox is rendered unconditionally in the component — only the
 * "Close" button is gated on `!firstRun`. The gate on a first run is
 * therefore enforced by the *absence* of a way to leave unchanged, not by
 * an extra control appearing, so the tests below assert on the Close button
 * (and on the confirm button's label, which does change with `firstRun`)
 * rather than on the skip checkbox, which is present either way.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SetupDialog } from '@renderer/components/SetupDialog'
import { stubArcadia } from './fixtures'
import type { EnvConfigValues } from '@shared/env-config'

const VALUES: EnvConfigValues = {
  STEAM_WEB_API_KEY: 'existing-web-key',
  STEAM_ID64: '76561198000000042',
  STEAMGRIDDB_API_KEY: 'existing-grid-key'
}

function renderSetup(overrides: Partial<Parameters<typeof SetupDialog>[0]> = {}) {
  const props = {
    values: VALUES,
    path: 'C:\\Users\\test\\.env',
    firstRun: false,
    onClose: vi.fn(),
    ...overrides
  }
  render(<SetupDialog {...props} />)
  return props
}

describe('SetupDialog', () => {
  it('prefills the three key fields from values', () => {
    stubArcadia()
    renderSetup()

    expect(screen.getByDisplayValue('existing-web-key')).toBeDefined()
    expect(screen.getByDisplayValue('76561198000000042')).toBeDefined()
    expect(screen.getByDisplayValue('existing-grid-key')).toBeDefined()
  })

  it('shows the path so the user knows which file is written', () => {
    stubArcadia()
    renderSetup({ path: 'D:\\game\\stuff\\.env' })

    expect(screen.getByText('Stored in D:\\game\\stuff\\.env')).toBeDefined()
  })

  it('saves all three keys', async () => {
    const saveEnvConfig = vi.fn(async () => ({ ok: true, restarting: false }))
    stubArcadia({ saveEnvConfig })
    renderSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveEnvConfig).toHaveBeenCalledOnce())
    expect(saveEnvConfig).toHaveBeenCalledWith(VALUES)
  })

  it('on first run there is no close control, only the way through', () => {
    stubArcadia()
    renderSetup({ firstRun: true })

    // No cancel on the gate: the only way past it is the confirm button,
    // which offers to save and restart (or, once skip is checked, to
    // continue without keys — covered separately below).
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeDefined()
  })

  it('once the question has been answered, closing unchanged is possible', () => {
    stubArcadia()
    const props = renderSetup({ firstRun: false })

    // Mirrors the previous test in the other direction: Close is present,
    // and the confirm button reverts to plain "Save" rather than the
    // first-run wording.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('skipping saves with no values — answered, nothing overwritten', async () => {
    const saveEnvConfig = vi.fn(async () => ({ ok: true, restarting: false }))
    stubArcadia({ saveEnvConfig })
    renderSetup({ firstRun: true })

    fireEvent.click(screen.getByRole('checkbox', { name: /^Skip configuration/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue without keys' }))

    await waitFor(() => expect(saveEnvConfig).toHaveBeenCalledOnce())
    expect(saveEnvConfig).toHaveBeenCalledWith(undefined)
  })

  it('shows the restarting state once the save reports it is restarting', async () => {
    stubArcadia({ saveEnvConfig: async () => ({ ok: true, restarting: true }) })
    const props = renderSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDefined()
    )
    // Closing now would flash the library for the moment the restart takes.
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('shows the error and stays open when saving fails', async () => {
    stubArcadia({
      saveEnvConfig: async () => ({
        ok: false,
        restarting: false,
        error: 'Could not write the file: EACCES'
      })
    })
    const props = renderSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByText('Could not write the file: EACCES')).toBeDefined()
    )
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
