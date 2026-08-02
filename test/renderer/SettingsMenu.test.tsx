/**
 * The gear menu.
 *
 * Holds the two settings that are chosen once and then forgotten. Its
 * dismissal is shared with the store filter through useDismiss, and is
 * tested on both because a regression in one would otherwise show up only
 * in whichever the user happened to open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsMenu } from '@renderer/components/SettingsMenu'
import { LanguageProvider } from '@renderer/i18n/LanguageProvider'
import { setLanguage } from '@shared/i18n'
import { stubArcadia } from './fixtures'

function renderMenu(onOpenSetup = vi.fn()) {
  stubArcadia()
  render(
    <LanguageProvider>
      <SettingsMenu onOpenSetup={onOpenSetup} />
    </LanguageProvider>
  )
  return onOpenSetup
}

describe('SettingsMenu', () => {
  afterEach(() => {
    // The language is module-level state shared across the worker; left
    // switched it would leak into whichever test file runs next.
    setLanguage('en')
  })

  it('opens and closes on the gear', () => {
    renderMenu()
    const trigger = screen.getByLabelText('Settings')

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeDefined()

    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the configuration screen and closes itself', () => {
    const onOpenSetup = renderMenu()

    fireEvent.click(screen.getByLabelText('Settings'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Configuration/ }))

    expect(onOpenSetup).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks the current language', () => {
    renderMenu()
    fireEvent.click(screen.getByLabelText('Settings'))

    expect(
      screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('switches the language and closes', async () => {
    renderMenu()
    fireEvent.click(screen.getByLabelText('Settings'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }))

    expect(screen.queryByRole('menu')).toBeNull()
    // The label is now German, which is the visible proof the switch took.
    await waitFor(() => expect(screen.getByLabelText('Einstellungen')).toBeDefined())
  })

  it('closes on a click outside it', () => {
    renderMenu()
    fireEvent.click(screen.getByLabelText('Settings'))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
