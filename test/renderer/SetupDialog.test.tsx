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
import { STORE_IDS } from '@shared/types'
import { t } from '@shared/i18n'

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
    enabledStores: [...STORE_IDS],
    onEnabledStoresChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  render(<SetupDialog {...props} />)
  return props
}

/** The dialog opens on the stores tab; most of these tests want the other. */
function showKeys(): void {
  fireEvent.click(screen.getByRole('tab', { name: /api keys/i }))
}

describe('SetupDialog', () => {
  it('opens on the stores tab', () => {
    stubArcadia()
    renderSetup()

    expect(screen.getByRole('checkbox', { name: /steam/i })).toBeDefined()
    // The keys are one click away, not on screen. Queried by value to match
    // how the rest of this file finds these fields.
    expect(screen.queryByDisplayValue('existing-web-key')).toBeNull()
  })

  it('shows the keys and hides the stores on the other tab', () => {
    stubArcadia()
    renderSetup()

    showKeys()

    expect(screen.getByDisplayValue('existing-web-key')).toBeDefined()
    // Asserted on the line that exists only in the stores panel: the store
    // checkboxes' accessible names carry their status text too, which makes
    // an anchored name match fragile.
    expect(screen.queryByText(t().setup.storesApplyAtOnce)).toBeNull()
  })

  it('says the store ticks need no saving', () => {
    stubArcadia()
    renderSetup()

    // Otherwise the shared Save button implies they are still pending.
    expect(screen.getByText(t().setup.storesApplyAtOnce)).toBeDefined()
  })

  it('can be saved from the stores tab', async () => {
    stubArcadia()
    const saveEnvConfig = vi.fn(async () => ({ ok: true, restarting: false }))
    window.arcadia.saveEnvConfig = saveEnvConfig
    const props = renderSetup()

    // Never navigating to the keys tab must still answer the question. On a
    // first run this button is the only way out of the dialog, so if it
    // lived inside the keys panel the user would be stranded here.
    fireEvent.click(screen.getByRole('button', { name: t().setup.save }))

    await waitFor(() => expect(saveEnvConfig).toHaveBeenCalled())
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('offers no close on either tab during the first run', () => {
    stubArcadia()
    renderSetup({ firstRun: true })

    expect(screen.queryByRole('button', { name: t().setup.close })).toBeNull()
    showKeys()
    expect(screen.queryByRole('button', { name: t().setup.close })).toBeNull()
  })

  it('closes on Escape from the keys tab too', () => {
    stubArcadia()
    const props = renderSetup()

    showKeys()
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalled()
  })

  it('focuses the first key field when its tab appears', () => {
    stubArcadia()
    renderSetup()

    showKeys()

    expect(document.activeElement).toBe(screen.getByDisplayValue('existing-web-key'))
  })

  it('moves between tabs with the arrow keys', () => {
    stubArcadia()
    renderSetup()
    const stores = screen.getByRole('tab', { name: t().setup.storesTitle })

    fireEvent.keyDown(stores, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: /api keys/i }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('prefills the three key fields from values', () => {
    stubArcadia()
    renderSetup()

    showKeys()

    expect(screen.getByDisplayValue('existing-web-key')).toBeDefined()
    expect(screen.getByDisplayValue('76561198000000042')).toBeDefined()
    expect(screen.getByDisplayValue('existing-grid-key')).toBeDefined()
  })

  it('shows the path so the user knows which file is written', () => {
    stubArcadia()
    renderSetup({ path: 'D:\\game\\stuff\\.env' })

    showKeys()

    expect(screen.getByText('Stored in D:\\game\\stuff\\.env')).toBeDefined()
  })

  it('saves all three keys', async () => {
    const saveEnvConfig = vi.fn(async () => ({ ok: true, restarting: false }))
    stubArcadia({ saveEnvConfig })
    renderSetup()

    showKeys()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveEnvConfig).toHaveBeenCalledOnce())
    expect(saveEnvConfig).toHaveBeenCalledWith(VALUES)
  })

  it('sends edits to the field they were typed into, not the prefilled values', async () => {
    // Without this, "saves all three keys" only pins the pass-through of the
    // *unedited* prop — it clicks Save without typing anything, so it cannot
    // catch a wrong `field.key` capture, a missing state update, or a stale
    // closure in the field's onChange (SetupDialog.tsx:131-133). Editing two
    // fields to distinct values and checking each lands under its own key
    // catches a handler that writes every edit to the same key, or swaps
    // which key an edit lands under, which editing a single field would not.
    const saveEnvConfig = vi.fn(async () => ({ ok: true, restarting: false }))
    stubArcadia({ saveEnvConfig })
    renderSetup()

    showKeys()

    fireEvent.change(screen.getByLabelText(/^Steam Web API key/), {
      target: { value: 'new-web-key' }
    })
    fireEvent.change(screen.getByLabelText(/^SteamGridDB API key/), {
      target: { value: 'new-grid-key' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveEnvConfig).toHaveBeenCalledOnce())
    expect(saveEnvConfig).toHaveBeenCalledWith({
      ...VALUES,
      STEAM_WEB_API_KEY: 'new-web-key',
      STEAMGRIDDB_API_KEY: 'new-grid-key'
    })
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

    showKeys()

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

  it('closes on Escape once the question has been answered', () => {
    stubArcadia()
    const props = renderSetup({ firstRun: false })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('does not close on Escape on the first run — the gate stays until answered', () => {
    stubArcadia()
    const props = renderSetup({ firstRun: true })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeDefined()
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

  it('stays open when Escape dismisses a store detail popover', async () => {
    stubArcadia({
      getStoreAvailability: async () => ({
        ubisoft: { available: true, limitations: ['Owned games from a local cache.'] }
      })
    })
    const props = renderSetup()

    fireEvent.click(await screen.findByRole('button', { name: /details about ubisoft/i }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    // The panel closes; the configuration screen behind it does not. Both
    // used to listen for Escape on document, which is why this is asserted
    // against the real dialog rather than against a stub of it.
    expect(screen.queryByText(/Owned games from a local cache\./)).toBeNull()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
