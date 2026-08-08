/**
 * The placeholder index.html paints before the bundle runs.
 *
 * The window is shown the moment it exists rather than at the renderer's
 * first paint, so something has to occupy it in the meantime; index.html
 * carries a name and a progress bar for exactly that. This file pins the one
 * assumption that markup rests on — that React takes the container over
 * rather than rendering below what is already in it. If that ever stopped
 * being true the placeholder would sit behind the library for the whole
 * session, and no other test would notice: every other renderer test mounts
 * into an empty div.
 */
import { describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { App } from '@renderer/App'
import { stubArcadia } from './fixtures'

/** The markup from src/renderer/index.html, copied as the page serves it. */
const BOOT_SHELL =
  '<div class="boot"><div class="boot__name">Arcadia</div><div class="boot__bar"></div></div>'

describe('the boot placeholder', () => {
  it('is gone once React has mounted into the same container', async () => {
    stubArcadia({ getGames: async () => [] })

    const container = document.createElement('div')
    container.id = 'root'
    container.innerHTML = BOOT_SHELL
    document.body.appendChild(container)
    expect(container.querySelector('.boot')).not.toBeNull()

    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })

    expect(container.querySelector('.boot')).toBeNull()
    // Positive check alongside the negative: an App that failed to render at
    // all would also leave no `.boot` behind, and would pass on that line
    // alone.
    expect(container.querySelector('.app')).not.toBeNull()

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
