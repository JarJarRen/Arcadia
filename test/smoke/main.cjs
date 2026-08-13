/**
 * Smoke test for the layout of the library view.
 *
 * Why this test exists: the unit tests cover parsers, adapters, database
 * and filter logic — but none of them ever renders a component. A CSS bug
 * therefore made every tile collapse to 6 pixels tall without a single test
 * turning red. The bug was visible in the user's screenshot and nowhere
 * else.
 *
 * A DOM stub such as jsdom would not have found it either: jsdom computes
 * no layout. That needs a real rendering engine, which means Electron
 * itself.
 *
 * Run with: npm run smoke   (requires a successful npm run build)
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const MIN_CARD_HEIGHT = 150

function check(result) {
  const problems = []
  if (result.cardCount === 0) problems.push('Not a single tile was rendered.')
  if (result.cardHeight < MIN_CARD_HEIGHT) {
    problems.push(
      `Tile height ${result.cardHeight}px is below ${MIN_CARD_HEIGHT}px — the tiles have collapsed.`
    )
  }
  if (result.artHeight > result.cardHeight) {
    problems.push(
      `The artwork (${result.artHeight}px) is taller than the tile ` +
        `(${result.cardHeight}px) and gets cut off.`
    )
  }
  if (!result.titleVisible) problems.push('The game title is not visible.')
  if (!result.buttonVisible) problems.push('The play button is not visible.')
  if (result.stylesheets === 0) problems.push('No stylesheet was loaded.')

  // The store switch only appears for multiply-registered games. The stub
  // provides exactly one such entry.
  if (!result.switchVisible) {
    problems.push('The store switch of the merged entry is not visible.')
  }
  if (result.switchOptions !== 2) {
    problems.push(
      `The switch shows ${result.switchOptions} stores instead of 2 — ` +
        'either a source is missing or too many are shown.'
    )
  }
  if (result.switchCount !== 1) {
    problems.push(
      `${result.switchCount} switches in the grid instead of 1 — it may only appear ` +
        'for multiply-registered games, not for every one.'
    )
  }

  // Steam's artwork is 600x900 (2:3), Epic's 1200x1600 (3:4). Without a
  // fixed ratio the image decides the tile height and the grid turns
  // ragged: measured at 313px, 278px and 117px side by side. That is
  // exactly what the user saw.
  const [withoutImage, epicRatio, steamRatio] = result.artHeights ?? [0, 0, 0]
  if (steamRatio === 0 || epicRatio === 0 || withoutImage === 0) {
    problems.push('The test tiles for image height were not found.')
  } else if (steamRatio !== epicRatio || steamRatio !== withoutImage) {
    problems.push(
      `Unequal image heights: without image ${withoutImage}px, Epic ratio ${epicRatio}px, ` +
        `Steam ratio ${steamRatio}px. All three have to match.`
    )
  }

  // Install button and shared badge. Both have to appear on the right tile
  // — and not on the wrong one.
  const shared = result.shared
  if (shared === null || shared === undefined) {
    problems.push('The test tile for install/shared was not found.')
  } else {
    if (shared.buttonText === null || !shared.buttonText.includes('Install')) {
      problems.push(
        `An uninstalled tile shows "${shared.buttonText}" instead of "Install".`
      )
    }
    if (!shared.buttonEnabled) problems.push('The install button is greyed out.')
    if (!shared.badge) problems.push('The "Shared/Free" badge is missing from the shared tile.')
    if (shared.installedButton === null || !shared.installedButton.includes('Play')) {
      problems.push(
        `An installed tile shows "${shared.installedButton}" instead of "Play".`
      )
    }
    if (shared.installedBadge) {
      problems.push('A licensed tile wrongly carries the "Shared/Free" badge.')
    }
  }

  // A CSP violation is silent in production: Chromium blocks the image and
  // only writes to the console. Without this check the tiles would stay
  // empty without any test firing.
  if (result.imageLoaded === 'no-network') {
    console.log('NOTE: image test skipped — no network connection.')
  } else if (result.imageLoaded !== true) {
    problems.push(
      'An image from cdn1.epicgames.com was not loaded. Either the CSP blocks it, ' +
        'or the test address is out of date.'
    )
  }

  // The free-games grid. A closed overlay and an open-but-empty one are
  // different bugs — the first means the toolbar button did nothing, the
  // second means the page itself is broken — so they get different
  // messages rather than both reading as "no cards".
  if (!result.freebiesOpened) {
    problems.push('The freebies button did nothing — the free-games page never opened.')
  } else if (result.freebieCount === 0) {
    problems.push('The free-games page rendered no cards.')
  } else if (result.freebieHeight < MIN_CARD_HEIGHT) {
    problems.push(
      `Free-games card height ${result.freebieHeight}px is below ${MIN_CARD_HEIGHT}px — ` +
        'the cards have collapsed.'
    )
  }

  // Every card's claim button (or, once confirmed, its "In your library"
  // text) has to sit on the same bottom edge as its row neighbours — a card
  // with a two-line title must not push its button lower than a card with a
  // one-line title. `margin-top: auto` only does that when the flex column
  // above it actually stretches to fill the card; this is what catches it
  // silently not doing so.
  const rowsWithAction = (result.freebieRows ?? []).filter((row) => row.actionBottom !== null)
  if (rowsWithAction.length > 1) {
    const bottoms = rowsWithAction.map((row) => row.actionBottom)
    const min = Math.min(...bottoms)
    const max = Math.max(...bottoms)
    if (max - min > 1) {
      problems.push(
        `Free-games action elements do not share a bottom edge: ` +
          rowsWithAction.map((row) => `"${row.title}" at ${row.actionBottom}px`).join(', ') +
          '.'
      )
    }
  }

  // Neither bar may need more width than it has at the app's default window
  // size — that is what "wraps to a second line" means for a flex-wrap row.
  // One pixel of tolerance for rounding between getBoundingClientRect and
  // the integer scrollWidth/clientWidth.
  if (result.toolbarScrollWidth > result.toolbarClientWidth + 1) {
    problems.push(
      `The library toolbar needs ${result.toolbarScrollWidth}px but only has ` +
        `${result.toolbarClientWidth}px — it wraps to a second line.`
    )
  }
  if (result.freebiesHeaderScrollWidth > result.freebiesHeaderClientWidth + 1) {
    problems.push(
      `The free-games header needs ${result.freebiesHeaderScrollWidth}px but only has ` +
        `${result.freebiesHeaderClientWidth}px — it wraps to a second line.`
    )
  }

  // The two bars are meant to look like one continuous piece of chrome as
  // the page changes underneath them; a height mismatch is exactly what
  // gave that away before .freebies__header picked up .toolbar's min-height.
  if (Math.abs(result.toolbarHeight - result.freebiesHeaderHeight) > 1) {
    problems.push(
      `The library toolbar is ${result.toolbarHeight}px tall but the free-games header is ` +
        `${result.freebiesHeaderHeight}px — they no longer match.`
    )
  }
  return problems
}

/**
 * Fail loudly instead of hanging.
 *
 * `executeJavaScript` rejects when the injected script throws, and without
 * this the rejection goes unhandled: `app.exit()` is never reached, Electron
 * stays alive and the run has to be killed by hand after the timeout. That
 * happened once, after the view switch changed from a select to buttons and
 * the script that drove it kept reaching for `.value` on `undefined` — ten
 * minutes of silence for a one-line error.
 */
/**
 * What the renderer itself complained about.
 *
 * At module scope rather than beside the window, because the handler below
 * is where it is needed most: a rejected script exits immediately and never
 * reaches the summary at the end, so this was the one path where the real
 * message had nowhere to be printed.
 */
const rendererErrors = []

process.on('unhandledRejection', (reason) => {
  console.log('PROBLEM: a smoke-test script threw:', reason)
  // Electron's own message for this says only "an error was thrown, check
  // the renderer console" — and the console it means is discarded when the
  // process exits. Whatever the renderer logged is almost always the actual
  // cause, so it goes out here rather than being left to be rediscovered.
  for (const message of rendererErrors) {
    console.log('PROBLEM: the renderer logged an error:', message)
  }
  console.log('RESULT: FAILED')
  app.exit(1)
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    // Mirrors createWindow's default in src/main/index.ts — the toolbar
    // no-wrap assertions below are only meaningful measured at the size the
    // app actually opens at.
    width: 1480,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  /**
   * Why the renderer's own errors are worth collecting at all: the failure
   * they explain arrives somewhere else entirely. A throw inside a
   * `useEffect` has no error boundary above it, so React tears the whole
   * root down; every script after that point then measures an empty
   * document, and the first one to reach for a real element rejects with
   * Electron's "Script failed to execute". That is what `getLanguage`
   * missing from preload.cjs looked like — a null `.click()` target six
   * hundred lines below the actual cause.
   */
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') rendererErrors.push(event.message)
  })
  // A preload that throws leaves `window.arcadia` undefined altogether, and
  // then every single measurement fails at once for one reason.
  win.webContents.on('preload-error', (_event, path, error) => {
    rendererErrors.push(`preload ${path} threw: ${String(error)}`)
  })

  await win.loadFile(join(__dirname, '../../out/renderer/index.html'))
  // React has to run once before anything can be measured.
  await new Promise((resolve) => setTimeout(resolve, 1500))

  const result = await win.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('.card')
    const art = card && card.querySelector('.card__art')
    const title = card && card.querySelector('.card__title')
    const button = card && card.querySelector('.button--primary')
    const box = (el) => (el ? el.getBoundingClientRect() : { height: 0, width: 0 })
    const sw = card && card.querySelector('.storeswitch')

    // Toolbar geometry: height, and the width the row needs versus the width
    // it has. Both bars use \`flex-wrap: wrap\`, so a row that runs out of
    // space grows a second line rather than overflowing horizontally, and
    // forcing \`nowrap\` alone is not enough to see that either: the search
    // field (\`flex: 1 1 240px\`) just shrinks to absorb the missing space
    // instead of overflowing. \`width: max-content\` removes the parent's
    // width constraint so the row reports what it would need at its natural,
    // unshrunk size. Both are restored immediately after the read.
    const measureRow = (el) => {
      if (!el) return { height: 0, scrollWidth: 0, clientWidth: 0 }
      const height = Math.round(el.getBoundingClientRect().height)
      const clientWidth = el.clientWidth
      const prevWrap = el.style.flexWrap
      const prevWidth = el.style.width
      el.style.flexWrap = 'nowrap'
      el.style.width = 'max-content'
      const scrollWidth = el.scrollWidth
      el.style.flexWrap = prevWrap
      el.style.width = prevWidth
      return { height, scrollWidth: Math.round(scrollWidth), clientWidth: Math.round(clientWidth) }
    }
    const toolbarGeometry = measureRow(document.querySelector('.toolbar'))

    // The free-games grid. Measured for the same reason as the library
    // tiles above: a CSS bug once collapsed all 193 of them to 6 pixels
    // with every unit test green, and jsdom computes no layout.
    //
    // Whether the overlay opened at all is checked separately from whether
    // it holds any cards. A button that silently does nothing and a page
    // that opens onto an empty grid are different bugs; a bare
    // \`cardCount === 0\` could not tell them apart, and would blame "no
    // cards" on a click that never landed.
    document.querySelector('.toolbar__freebies')?.click()
    let freebiesOpened = false
    let freebie = null
    for (let waited = 0; waited < 2000; waited += 50) {
      freebiesOpened = document.querySelector('.freebies') !== null
      freebie = document.querySelector('.freebie')
      if (freebie !== null) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const freebieCard = freebie === null ? null : freebie.getBoundingClientRect()
    const freebiesHeaderGeometry = measureRow(document.querySelector('.freebies__header'))

    // Bottom edge of every card's action element (the claim button, or the
    // "In your library" text once confirmed) and of the card itself. A card
    // with a two-line title has more content above the button than one with
    // a one-line title; \`margin-top: auto\` is only supposed to absorb that
    // difference so every button still lands on the same line.
    const freebieRows = [...document.querySelectorAll('.freebie')].map((el) => {
      const action = el.querySelector('.freebie__claim, .freebie__claimed')
      const title = el.querySelector('.freebie__title')
      return {
        title: title ? title.textContent : null,
        cardBottom: Math.round(el.getBoundingClientRect().bottom),
        cardHeight: Math.round(el.getBoundingClientRect().height),
        actionBottom: action ? Math.round(action.getBoundingClientRect().bottom) : null
      }
    })

    return {
      stylesheets: document.styleSheets.length,
      toolbarHeight: toolbarGeometry.height,
      toolbarScrollWidth: toolbarGeometry.scrollWidth,
      toolbarClientWidth: toolbarGeometry.clientWidth,
      freebiesHeaderHeight: freebiesHeaderGeometry.height,
      freebiesHeaderScrollWidth: freebiesHeaderGeometry.scrollWidth,
      freebiesHeaderClientWidth: freebiesHeaderGeometry.clientWidth,
      cardCount: document.querySelectorAll('.card').length,
      cardHeight: Math.round(box(card).height),
      artHeight: Math.round(box(art).height),
      titleVisible: box(title).height > 0 && box(title).width > 0,
      buttonVisible: box(button).height > 0 && box(button).width > 0,
      titleText: title ? title.textContent : null,
      switchVisible: box(sw).height > 0 && box(sw).width > 0,
      switchOptions: sw ? sw.querySelectorAll('.storeswitch__option').length : 0,
      switchCount: document.querySelectorAll('.storeswitch').length,
      badges: card ? card.querySelectorAll('.badge').length : 0,

      // Image heights of the three test tiles: without image, Epic ratio
      // (3:4), Steam ratio (2:3). They have to match. The stub creates them
      // as ZZA/ZZB/ZZC — at the end of the alphabet, because the view sorts
      // by name and they would otherwise displace the first tile, which all
      // the other checks hang off.
      artHeights: ['ZZA', 'ZZB', 'ZZC'].map((prefix) => {
        const heading = [...document.querySelectorAll('.card__title')]
          .find((t) => t.textContent.startsWith(prefix))
        const tile = heading ? heading.closest('.card') : null
        const artwork = tile ? tile.querySelector('.card__art') : null
        return artwork ? Math.round(artwork.getBoundingClientRect().height) : 0
      }),

      // ZZD is neither installed nor licensed. There used to be a dead
      // button reading "Not installed" there; the same spot now leads to
      // the store dialog.
      shared: (() => {
        const heading = [...document.querySelectorAll('.card__title')]
          .find((t) => t.textContent.startsWith('ZZD'))
        const tile = heading ? heading.closest('.card') : null
        if (tile === null) return null
        const button = tile.querySelector('.button--primary')
        const installed = [...document.querySelectorAll('.card')]
          .find((c) => c.querySelector('.card__title').textContent.startsWith('ZZC'))
        return {
          buttonText: button ? button.textContent.trim() : null,
          buttonEnabled: button ? !button.disabled : false,
          badge: tile.querySelector('.badge--shared') !== null,
          // The counter-check: an installed tile must have neither.
          installedButton: installed
            ? installed.querySelector('.button--primary').textContent.trim()
            : null,
          installedBadge: installed
            ? installed.querySelector('.badge--shared') !== null
            : true
        }
      })(),

      freebiesOpened,
      freebieCount: document.querySelectorAll('.freebie').length,
      freebieHeight: freebieCard === null ? 0 : Math.round(freebieCard.height),
      freebieRows
    }
  })()`)

  // A click on Install has to make the hint visible when the store merely
  // opened its library. Without it the click would look as though it had
  // fizzled out — which is exactly how the first, guessed EA URI felt.
  result.hint = await win.webContents.executeJavaScript(`
    (async () => {
      const button = [...document.querySelectorAll('.card')]
        .map((c) => ({ c, t: c.querySelector('.card__title').textContent }))
        .find((x) => x.t.startsWith('ZZD'))
        ?.c.querySelector('.button--primary')
      if (!button) return { found: false }
      button.click()
      await new Promise((r) => setTimeout(r, 400))
      const banner = document.querySelector('.banner--notice')
      const box = banner ? banner.getBoundingClientRect() : { height: 0 }
      return {
        found: true,
        visible: Math.round(box.height) > 0,
        text: banner ? banner.textContent : null,
        // A hint is not an error message — otherwise a successful action
        // would look like a failure.
        asError: document.querySelector('.banner--error') !== null
      }
    })()
  `)

  const hintProblems = []
  if (result.hint?.found !== true) {
    hintProblems.push('The install button for the hint test was not found.')
  } else {
    if (!result.hint.visible) {
      hintProblems.push('No hint appears after clicking Install.')
    }
    if (result.hint.asError) {
      hintProblems.push('The hint appears as an error message although the action succeeded.')
    }
  }

  // Real image URL from Epic's catalogue on the development machine. Tests
  // the CSP against the living thing rather than against its wording.
  const IMAGE =
    'https://cdn1.epicgames.com/047392e91d5e4cfdb19e2767440ab206/item/' +
    'EGS_JurassicWorldEvolution_FrontierDevelopments_S2-1200x1600-' +
    'd132a04130d2fad11948e182046f50dc.jpg'

  result.imageLoaded = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 0)
      img.onerror = () => resolve(navigator.onLine ? false : 'no-network')
      img.src = ${JSON.stringify(IMAGE)}
      setTimeout(() => resolve(navigator.onLine ? false : 'no-network'), 10000)
    })
  `)

  // ── Second phase: the details page ───────────────────────────────────
  // For the same reason as above: jsdom computes no layout. The page has a
  // background image with absolute positioning, a two-column grid and a
  // gallery — any of them can collapse without a unit test ever noticing.
  await win.webContents.executeJavaScript(`
    document.querySelector('.card__open').click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 600))

  const detail = await win.webContents.executeJavaScript(`(() => {
    const box = (el) => (el ? el.getBoundingClientRect() : { height: 0, width: 0 })
    const page = document.querySelector('.detail')
    const hero = document.querySelector('.detail__hero')
    const title = document.querySelector('.detail__title')
    const text = document.querySelector('.detail__text')
    const sidebar = document.querySelector('.detail__side')
    const tile = document.querySelector('.gallery__button')
    return {
      pageThere: page !== null,
      // The page covers the library rather than replacing it, so that the
      // list keeps its scroll position. What matters is therefore not that
      // the tiles are gone from the DOM but that none of them can be seen:
      // the overlay has to fill the window and be opaque.
      overlayCovers: (() => {
        const overlay = document.querySelector('.detailoverlay')
        if (overlay === null) return false
        const box = overlay.getBoundingClientRect()
        const style = getComputedStyle(overlay)
        const opaque =
          style.backgroundColor !== 'transparent' &&
          !style.backgroundColor.includes('rgba(0, 0, 0, 0)')
        return (
          opaque &&
          box.width >= window.innerWidth &&
          box.height >= window.innerHeight &&
          box.top <= 0 &&
          box.left <= 0
        )
      })(),
      heroHeight: Math.round(box(hero).height),
      titleText: title ? title.textContent : null,
      textHeight: Math.round(box(text).height),
      sidebarWidth: Math.round(box(sidebar).width),
      galleryTiles: document.querySelectorAll('.gallery__button').length,
      galleryTileHeight: Math.round(box(tile).height),
      facts: document.querySelectorAll('.fact').length,
      // Horizontal overflow of the window: the most common layout bug with
      // long paths and wide images.
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }
  })()`)

  // Back to the grid — otherwise the page would be a dead end.
  await win.webContents.executeJavaScript(`document.querySelector('.detail__back').click()`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  detail.backInGrid = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.card').length`
  )

  const detailProblems = []
  if (!detail.pageThere) detailProblems.push('A click on the tile opened no details page.')
  if (!detail.overlayCovers) {
    detailProblems.push(
      'The details page does not cover the library — the grid shows through behind it.'
    )
  }
  if (detail.heroHeight < 200) {
    detailProblems.push(`The header is ${detail.heroHeight}px tall — it has collapsed.`)
  }
  if (detail.titleText === null || !detail.titleText.includes('Far Cry 4')) {
    detailProblems.push(`The page shows "${detail.titleText}" instead of "Far Cry 4".`)
  }
  if (detail.textHeight < 100) {
    detailProblems.push(
      `The description is ${detail.textHeight}px tall — it is missing or cut off.`
    )
  }
  if (detail.sidebarWidth < 200) {
    detailProblems.push(
      `The facts column is ${detail.sidebarWidth}px wide — the grid is broken.`
    )
  }
  if (detail.facts < 5) {
    detailProblems.push(`Only ${detail.facts} facts visible — at least 5 are expected.`)
  }
  // The stub supplies 181 screenshots. Showing all of them would mean
  // pulling 181 images from Valve's servers; the page would be busy for
  // minutes.
  if (detail.galleryTiles !== 12) {
    detailProblems.push(
      `The gallery shows ${detail.galleryTiles} of 181 screenshots instead of the capped 12.`
    )
  }
  if (detail.galleryTileHeight < 60) {
    detailProblems.push(
      `The gallery tiles are ${detail.galleryTileHeight}px tall — they have collapsed. ` +
        'This is exactly the bug that hit the library in plan 1.'
    )
  }
  if (detail.overflow) detailProblems.push('The page overflows the window horizontally.')
  if (detail.backInGrid === 0) {
    detailProblems.push('Back did not lead to the grid — the page is a dead end.')
  }

  // ---------------------------------------------------------------- list
  //
  // The split view is the one thing jsdom could never check: two panes side
  // by side is entirely a layout question, and layout is what jsdom does not
  // compute. The 6-pixel-tile bug in plan 1 survived a green unit suite for
  // exactly that reason.
  await win.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('.viewtoggle__option[data-view="list"]')
    if (list === null) throw new Error('The list button is missing from the toolbar.')
    list.click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 400))

  const list = await win.webContents.executeJavaScript(`(() => {
    const pane = document.querySelector('.listpane')
    const rows = document.querySelectorAll('.listrow')
    const first = rows[0]
    return {
      listPaneWidth: pane === null ? 0 : Math.round(pane.getBoundingClientRect().width),
      rowCount: rows.length,
      rowHeight: first === undefined ? 0 : Math.round(first.getBoundingClientRect().height),
      // Nothing selected yet: the right-hand side shows the placeholder.
      placeholder: document.querySelector('.detailpane .hint') !== null,
      gridGone: document.querySelectorAll('.card').length
    }
  })()`)

  // Pick a row and measure the pane beside it.
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.listrow')[0].click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 400))

  const listDetail = await win.webContents.executeJavaScript(`(() => {
    const pane = document.querySelector('.detailpane')
    const detail = document.querySelector('.detailpane .detail')
    const cols = document.querySelector('.detailpane .detail__cols')
    const title = document.querySelector('.detailpane .detail__title')
    const listStill = document.querySelector('.listpane')
    const paneBox = pane === null ? null : pane.getBoundingClientRect()
    const listBox = listStill === null ? null : listStill.getBoundingClientRect()
    return {
      listStillVisible: listBox !== null && listBox.width > 100,
      detailThere: detail !== null,
      isPaneVariant: detail !== null && detail.classList.contains('detail--pane'),
      // One column, i.e. the facts sit under the description rather than
      // beside it.
      columnCount:
        cols === null ? 0 : getComputedStyle(cols).gridTemplateColumns.trim().split(/\\s+/).length,
      // The pane has no back button; the list is already on screen.
      backButtons: document.querySelectorAll('.detailpane .detail__back').length,
      title: title === null ? '' : title.textContent,
      detailPaneWidth: paneBox === null ? 0 : Math.round(paneBox.width),
      selectedRows: document.querySelectorAll('.listrow--selected').length,
      // The actual claim of a split view, and the one thing width alone
      // cannot express: the two panes sit beside each other, not stacked.
      // Collapsing the grid to a single column leaves both at full width and
      // every width check still passing — measured, which is why this is
      // here.
      sideBySide:
        paneBox !== null &&
        listBox !== null &&
        listBox.right <= paneBox.left + 1 &&
        listBox.top < paneBox.bottom &&
        paneBox.top < listBox.bottom,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }
  })()`)

  // The mouse's back button clears the selection, as in a browser. Checked
  // here rather than in a unit test because it hangs off a real DOM event on
  // window — dispatching it needs an actual renderer.
  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true }))
  `)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const afterBack = await win.webContents.executeJavaScript(`(() => ({
    selectedRows: document.querySelectorAll('.listrow--selected').length,
    placeholder: document.querySelector('.detailpane .hint') !== null,
    listStillThere: document.querySelectorAll('.listrow').length
  }))()`)

  // A thumbnail per row, and the same 2:3 portrait as the tile.
  const thumbs = await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('.listrow')]
    const withImage = rows.filter((r) => r.querySelector('.listrow__image') !== null)
    const art = rows[0] ? rows[0].querySelector('.listrow__art') : null
    const box = art === null ? null : art.getBoundingClientRect()
    return {
      rowsWithArt: rows.filter((r) => r.querySelector('.listrow__art') !== null).length,
      rowsWithImage: withImage.length,
      artWidth: box === null ? 0 : Math.round(box.width),
      artHeight: box === null ? 0 : Math.round(box.height)
    }
  })()`)

  const listProblems = []
  if (afterBack.selectedRows !== 0) {
    listProblems.push(
      `The mouse back button left ${afterBack.selectedRows} rows selected — it did nothing.`
    )
  }
  if (!afterBack.placeholder) {
    listProblems.push('After going back the detail pane shows no placeholder.')
  }
  if (afterBack.listStillThere === 0) {
    listProblems.push('Going back emptied the list as well.')
  }
  if (thumbs.rowsWithArt === 0) listProblems.push('No list row has a thumbnail slot.')
  if (thumbs.rowsWithImage === 0) {
    listProblems.push('Not one list row rendered an actual image — only placeholders.')
  }
  if (thumbs.artHeight < 20) {
    listProblems.push(`The thumbnails are ${thumbs.artHeight}px tall — collapsed.`)
  }
  // 2:3, the same crop as the tile. Rounding leaves a pixel of slack.
  if (Math.abs(thumbs.artHeight / thumbs.artWidth - 1.5) > 0.1) {
    listProblems.push(
      `The thumbnails are ${thumbs.artWidth}x${thumbs.artHeight} — that is not the 2:3 ` +
        'portrait the tiles use.'
    )
  }
  if (list.listPaneWidth < 200) {
    listProblems.push(`The list pane is ${list.listPaneWidth}px wide — it has collapsed.`)
  }
  if (list.rowCount === 0) listProblems.push('The list rendered no rows at all.')
  if (list.rowHeight < 20) {
    listProblems.push(
      `The rows are ${list.rowHeight}px tall — collapsed, the same class of bug as plan 1.`
    )
  }
  if (!list.placeholder) {
    listProblems.push('With nothing selected the detail pane shows no placeholder.')
  }
  if (list.gridGone !== 0) {
    listProblems.push(`${list.gridGone} tiles are still there — the grid did not give way.`)
  }
  if (!listDetail.listStillVisible) {
    listProblems.push('Selecting a row hid the list — the whole point of the split view.')
  }
  if (!listDetail.sideBySide) {
    listProblems.push(
      'List and detail are not beside each other — the panes are stacked, ' +
        'so the split view is a split view in name only.'
    )
  }
  if (list.listPaneWidth > 700) {
    listProblems.push(
      `The list pane is ${list.listPaneWidth}px wide — it has taken the whole window ` +
        'instead of leaving room for the detail.'
    )
  }
  if (!listDetail.detailThere) listProblems.push('The detail pane stayed empty after selecting.')
  if (!listDetail.isPaneVariant) {
    listProblems.push('The detail did not render in its pane variant.')
  }
  if (listDetail.columnCount !== 1) {
    listProblems.push(
      `The facts sit in ${listDetail.columnCount} columns beside the description; ` +
        'in the pane they are supposed to stack underneath.'
    )
  }
  if (listDetail.backButtons !== 0) {
    listProblems.push('The pane shows a back button, which leads nowhere.')
  }
  if (listDetail.selectedRows !== 1) {
    listProblems.push(`${listDetail.selectedRows} rows are marked selected instead of exactly 1.`)
  }
  if (listDetail.detailPaneWidth < 300) {
    listProblems.push(
      `The detail pane is ${listDetail.detailPaneWidth}px wide — too narrow to read.`
    )
  }
  if (listDetail.overflow) listProblems.push('The split view overflows the window horizontally.')

  // ------------------------------------------------------- add-game dialog
  //
  // The validation is unit-tested; what only a real renderer can show is
  // whether the dialog opens at all and whether the submit button follows
  // the state of the fields.
  await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.toolbar .button')]
      .find((b) => b.textContent.includes('Add game'))
    if (button === undefined) throw new Error('The "Add game" button is missing.')
    button.click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 300))

  const dialog = await win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector('.modal__box')
    const fields = document.querySelectorAll('.modal__field')
    const submit = document.querySelector('.modal__actions .button--primary')
    return {
      open: box !== null,
      fields: fields.length,
      // Empty name — adding has to stay unavailable.
      submitDisabledWhenEmpty: submit === null ? false : submit.disabled
    }
  })()`)

  // --------------------------------------------- scroll position and forward
  //
  // Opening a game in grid mode unmounts the whole library, so the scroll
  // position is React's to lose. Only a real renderer can show whether it
  // comes back — jsdom computes no scrolling either.
  await win.webContents.executeJavaScript(`(() => {
    const cancel = document.querySelector('.modal__actions .button')
    if (cancel !== null) cancel.click()
    const grid = document.querySelector('.viewtoggle__option[data-view="grid"]')
    if (grid !== null) grid.click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 400))

  const scroll = await win.webContents.executeJavaScript(`(() => {
    const library = document.querySelector('.library')
    library.scrollTop = 900
    return {
      set: Math.round(library.scrollTop),
      hooked: library.getAttribute('data-scroll-hook'),
      tag: library.tagName,
      hookedElements: document.querySelectorAll('[data-scroll-hook]').length
    }
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Open a game from that position, then come back the way a mouse would.
  await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('.card__open')]
    const visible = cards.find((c) => {
      const box = c.getBoundingClientRect()
      return box.top > 100 && box.bottom < window.innerHeight
    })
    ;(visible ?? cards[0]).click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const openedTitle = await win.webContents.executeJavaScript(
    `document.querySelector('.detail__title') === null
       ? '' : document.querySelector('.detail__title').textContent`
  )

  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true }))`
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
  const afterReturn = await win.webContents.executeJavaScript(`(() => {
    const library = document.querySelector('.library')
    return {
      backInGrid: document.querySelectorAll('.card').length,
      scrollTop: library === null ? -1 : Math.round(library.scrollTop),
      dbg: window.__dbg ?? null,
      events: window.__ev ?? 0,
      lastSeen: window.__last ?? null
    }
  })()`)

  // Forward reopens what back just closed, as a browser does.
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new MouseEvent('mouseup', { button: 4, bubbles: true }))`
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
  const afterForward = await win.webContents.executeJavaScript(
    `document.querySelector('.detail__title') === null
       ? '' : document.querySelector('.detail__title').textContent`
  )

  /*
   * Store multi-selection and sort direction.
   *
   * Both controls live entirely in the DOM — a popover that has to open,
   * receive several clicks without closing, and drive the filter; and a
   * button whose only job is to reverse a list. Nothing of that is reachable
   * from the Node tests, which see the pure functions and never a click.
   *
   * The stub library is built for this: exactly one Epic game, one EA game
   * and one Ubisoft source, against 203 on Steam. Any miscount is therefore
   * unmistakable rather than off by one in a sea of 205.
   */
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true }))`
  )
  await new Promise((resolve) => setTimeout(resolve, 300))

  const toolbar = await win.webContents.executeJavaScript(`(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 250))
    const trigger = document.querySelector('.popover__trigger')
    const count = () => document.querySelector('.toolbar__counttext').textContent
    const firstCard = () => {
      const card = document.querySelector('.card__open')
      return card === null ? '' : card.textContent
    }

    const initialLabel = trigger === null ? null : trigger.textContent
    const sortedAscending = firstCard()

    trigger.click()
    await wait()
    const items = [...document.querySelectorAll('.popover__panel [role="menuitemcheckbox"]')]
    const byName = (name) => items.find((i) => i.textContent.includes(name))

    byName('Epic').click()
    await wait()
    const oneStore = { label: trigger.textContent, count: count(), stillOpen: document.querySelector('.popover__panel') !== null }

    // A second store while the panel is still open — the whole point of a
    // popover over a single-choice select.
    byName('EA').click()
    await wait()
    const twoStores = { label: trigger.textContent, count: count() }

    byName('Epic').click()
    await wait()
    const unticked = { label: trigger.textContent, count: count() }

    const all = document.querySelector('.popover__panel [role="menuitemradio"]')
    all.click()
    await wait()
    const cleared = { label: trigger.textContent, count: count(), closed: document.querySelector('.popover__panel') === null }

    // The direction toggle: same key, reversed list.
    const toggle = [...document.querySelectorAll('.toolbar .button--icon')].find(
      (b) => b.textContent.includes('↑') || b.textContent.includes('↓')
    )
    const arrowBefore = toggle === undefined ? null : toggle.textContent
    toggle.click()
    await wait()
    const reversed = { arrow: toggle.textContent, first: firstCard() }
    toggle.click()
    await wait()

    return {
      initialLabel,
      sortedAscending,
      oneStore,
      twoStores,
      unticked,
      cleared,
      arrowBefore,
      reversed,
      restored: firstCard()
    }
  })()`)

  const toolbarProblems = []
  if (toolbar.initialLabel === null) {
    toolbarProblems.push('The store filter button was not rendered.')
  } else if (!toolbar.initialLabel.includes('All stores')) {
    toolbarProblems.push(
      `The store button opens on "${toolbar.initialLabel}" instead of "All stores".`
    )
  }
  if (toolbar.oneStore.count !== '1 of 205') {
    toolbarProblems.push(
      `Epic alone shows "${toolbar.oneStore.count}" instead of "1 of 205".`
    )
  }
  if (!toolbar.oneStore.label.includes('Epic')) {
    toolbarProblems.push(`The button reads "${toolbar.oneStore.label}" instead of "Epic".`)
  }
  if (!toolbar.oneStore.stillOpen) {
    toolbarProblems.push('The panel closed after one store — selecting several is impossible.')
  }
  if (toolbar.twoStores.count !== '2 of 205') {
    toolbarProblems.push(
      `Epic and EA together show "${toolbar.twoStores.count}" instead of "2 of 205" — ` +
        'the stores are not being ORed.'
    )
  }
  if (!toolbar.twoStores.label.includes('Epic') || !toolbar.twoStores.label.includes('EA')) {
    toolbarProblems.push(`Two stores are labelled "${toolbar.twoStores.label}".`)
  }
  if (toolbar.unticked.count !== '1 of 205') {
    toolbarProblems.push(
      `Unticking Epic left "${toolbar.unticked.count}" instead of the EA game alone.`
    )
  }
  if (toolbar.cleared.count !== '205 of 205') {
    toolbarProblems.push(
      `"All stores" shows "${toolbar.cleared.count}" instead of the whole library.`
    )
  }
  if (!toolbar.cleared.closed) {
    toolbarProblems.push('The panel stayed open after "All stores".')
  }
  if (toolbar.arrowBefore === null || !toolbar.arrowBefore.includes('↑')) {
    toolbarProblems.push(`The library opens on "${toolbar.arrowBefore}" instead of ascending.`)
  }
  if (!toolbar.reversed.arrow.includes('↓')) {
    toolbarProblems.push('The arrow did not follow the direction it set.')
  }
  if (toolbar.reversed.first === toolbar.sortedAscending) {
    toolbarProblems.push(
      `Reversing the direction left "${toolbar.reversed.first}" at the top — ` +
        'the list was not re-sorted.'
    )
  }
  if (toolbar.restored !== toolbar.sortedAscending) {
    toolbarProblems.push(
      `Toggling back gave "${toolbar.restored}" instead of "${toolbar.sortedAscending}".`
    )
  }

  /*
   * The configuration screen, opened from the gear.
   *
   * The gate itself cannot be exercised here — the stub reports the question
   * as answered, precisely so the dialog does not cover everything measured
   * above. What is checked is the other half of the feature: that the gear
   * still reaches it, that the fields arrive prefilled, that ticking "skip"
   * really does put the keys out of reach, and that the language switch the
   * menu existed for in the first place is still there.
   */
  const setup = await win.webContents.executeJavaScript(`(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 250))
    const box = () => document.querySelector('.modal__box--wide')

    document.querySelector('[aria-label="Settings"]').click()
    await wait()
    const panel = document.querySelector('.popover__panel')
    const entries = {
      configuration: [...panel.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent),
      languages: panel.querySelectorAll('[role="menuitemradio"]').length
    }

    panel.querySelector('[role="menuitem"]').click()
    await wait()

    const opened = box() !== null

    // The screen opens on the stores tab; everything measured below — the
    // three key fields, their links, and the skip answer — is on the other.
    // Selected by position, the way the Close button below is: there are
    // exactly two, stores first.
    box().querySelectorAll('[role="tab"]')[1].click()
    await wait()

    const inputs = () => [...box().querySelectorAll('.modal__field input')]
    const prefilled = inputs().map((i) => i.value)
    const links = box().querySelectorAll('.modal__link').length

    const skip = box().querySelector('.modal__toggle--skip input')
    skip.click()
    await wait()
    const disabledAfterSkip = inputs().every((i) => i.disabled)
    const buttonAfterSkip = box().querySelector('.button--primary').textContent

    skip.click()
    await wait()
    const buttonAfterUntick = box().querySelector('.button--primary').textContent

    // The first action is Close — present because this was opened from the
    // gear rather than as the first-run gate.
    box().querySelector('.modal__actions .button').click()
    await wait()

    return {
      entries,
      opened,
      prefilled,
      links,
      disabledAfterSkip,
      buttonAfterSkip,
      buttonAfterUntick,
      closed: box() === null,
      libraryStillThere: document.querySelectorAll('.card').length
    }
  })()`)

  const setupProblems = []
  if (setup.entries.configuration.length !== 1) {
    setupProblems.push(
      `The gear offers ${setup.entries.configuration.length} configuration entries instead of 1.`
    )
  }
  if (setup.entries.languages !== 2) {
    setupProblems.push(
      `The gear lists ${setup.entries.languages} languages instead of 2 — the ` +
        'configuration entry displaced the language switch.'
    )
  }
  if (!setup.opened) setupProblems.push('The gear did not open the configuration screen.')
  if (setup.prefilled.length !== 3) {
    setupProblems.push(`The screen shows ${setup.prefilled.length} fields instead of 3.`)
  }
  if (setup.prefilled[0] !== 'stub-steam-key' || setup.prefilled[2] !== 'stub-grid-key') {
    setupProblems.push(
      `The fields arrived as ${JSON.stringify(setup.prefilled)} instead of prefilled from the file.`
    )
  }
  if (setup.links !== 3) {
    setupProblems.push(`${setup.links} links to obtain a key instead of one per field.`)
  }
  if (!setup.disabledAfterSkip) {
    setupProblems.push('Ticking "skip" left the key fields editable.')
  }
  if (setup.buttonAfterSkip === setup.buttonAfterUntick) {
    setupProblems.push(
      `The button reads "${setup.buttonAfterSkip}" whether skipping or not — ` +
        'nothing tells the user which of the two will happen.'
    )
  }
  if (!setup.closed) setupProblems.push('Close did not close the configuration screen.')
  if (setup.libraryStillThere === 0) {
    setupProblems.push('The library was gone after the configuration screen closed.')
  }

  const navProblems = []
  if (afterReturn.backInGrid === 0) {
    navProblems.push('The back button did not return to the grid.')
  }
  if (Math.abs(afterReturn.scrollTop - scroll.set) > 40) {
    navProblems.push(
      `Coming back landed at ${afterReturn.scrollTop}px instead of ${scroll.set}px — ` +
        'the list jumped away from where the game was clicked.'
    )
  }
  if (openedTitle === '') navProblems.push('Clicking a tile opened no details page.')
  if (afterForward !== openedTitle) {
    navProblems.push(
      `Forward showed "${afterForward}" instead of reopening "${openedTitle}".`
    )
  }

  const addProblems = []
  if (!dialog.open) addProblems.push('The add-game dialog did not open.')
  if (dialog.fields !== 3) {
    addProblems.push(`The dialog shows ${dialog.fields} fields instead of name, store and ID.`)
  }
  if (!dialog.submitDisabledWhenEmpty) {
    addProblems.push('Adding is possible with an empty name.')
  }

  const problems = [
    // First in the list, because when the renderer has thrown, everything
    // below is a consequence of it rather than a finding of its own.
    ...rendererErrors.map((message) => `The renderer logged an error: ${message}`),
    ...check(result),
    ...hintProblems,
    ...detailProblems,
    ...listProblems,
    ...navProblems,
    ...addProblems,
    ...toolbarProblems,
    ...setupProblems
  ]

  console.log('--- Smoke test: library layout ---')
  console.log(JSON.stringify(result, null, 1))
  console.log('--- Smoke test: details page ---')
  console.log(JSON.stringify(detail, null, 1))
  console.log('--- Smoke test: list view ---')
  console.log(JSON.stringify({ ...list, ...listDetail }, null, 1))
  console.log('--- Smoke test: thumbnails and mouse back ---')
  console.log(JSON.stringify({ ...thumbs, afterBack }, null, 1))
  console.log('--- Smoke test: add-game dialog ---')
  console.log(JSON.stringify(dialog, null, 1))
  console.log('--- Smoke test: store multi-select and sort direction ---')
  console.log(JSON.stringify(toolbar, null, 1))
  console.log('--- Smoke test: configuration screen ---')
  console.log(JSON.stringify(setup, null, 1))
  console.log('--- Smoke test: scroll position and forward ---')
  console.log(
    JSON.stringify({ scrolledTo: scroll.set, hooked: scroll.hooked, tag: scroll.tag, hookedElements: scroll.hookedElements, ...afterReturn, openedTitle, afterForward }, null, 1)
  )
  if (problems.length === 0) {
    console.log('RESULT: PASSED')
    app.exit(0)
  } else {
    for (const problem of problems) console.log('PROBLEM:', problem)
    console.log('RESULT: FAILED')
    app.exit(1)
  }
})
