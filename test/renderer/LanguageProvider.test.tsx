/**
 * LanguageProvider's own startup contract, not SettingsMenu's.
 *
 * Main applies the persisted language to its own process at startup, but
 * the renderer holds a separate copy of the i18n module that always begins
 * at DEFAULT_LANGUAGE — it has to be told the persisted value explicitly.
 * SettingsMenu is used only as a probe here: its gear carries an
 * accessible name wired straight to `t().toolbar.settingsLabel`, which is
 * the shortest path to rendered text that genuinely differs between the
 * English and German bundles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@renderer/i18n/LanguageProvider'
import { SettingsMenu } from '@renderer/components/SettingsMenu'
import { setLanguage } from '@shared/i18n'
import { stubArcadia } from './fixtures'

describe('LanguageProvider', () => {
  afterEach(() => {
    // The language is module-level state shared across the worker; left
    // switched it would leak into whichever test file runs next.
    setLanguage('en')
  })

  it('adopts the persisted language once window.arcadia.getLanguage resolves', async () => {
    stubArcadia({ getLanguage: async () => 'de' })

    render(
      <LanguageProvider>
        <SettingsMenu onOpenSetup={vi.fn()} />
      </LanguageProvider>
    )

    // The gear's accessible name switching to German is proof the fetched
    // value reached both the i18n module and React state — a mismatch
    // between the two would leave this stuck in English (t() reads the
    // module) or never re-render at all (nothing reads the state).
    await waitFor(() => expect(screen.getByLabelText('Einstellungen')).toBeDefined())
  })

  it('does not echo the fetched value back through window.arcadia.setLanguage', async () => {
    const setLanguageIpc = vi.fn(async () => undefined)
    stubArcadia({ getLanguage: async () => 'de', setLanguage: setLanguageIpc })

    render(
      <LanguageProvider>
        <SettingsMenu onOpenSetup={vi.fn()} />
      </LanguageProvider>
    )

    await waitFor(() => expect(screen.getByLabelText('Einstellungen')).toBeDefined())

    // Main is where this value came from. Sending it back would be a
    // pointless round trip — and, worse, indistinguishable from the user
    // having deliberately chosen German just now.
    expect(setLanguageIpc).not.toHaveBeenCalled()
  })
})
