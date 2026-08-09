// Supplies the real interface with an invented library so the smoke test
// can check the layout without needing Steam, a database or the network.
// The shape matches ArcadiaApi from shared/ipc.ts exactly.
const { contextBridge } = require('electron')

function source(storeId, id, name, installed = true) {
  return {
    id: `${storeId}:${id}`,
    storeId,
    storeGameId: String(id),
    name,
    installed,
    installPath: `F:\\games\\${id}`,
    installSizeBytes: 24696061952,
    playtimeMinutes: 120,
    lastPlayed: 1699500000,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }
}

function entry(name, sources, artwork = [], metadata = undefined) {
  const active = sources.find((s) => s.installed) ?? sources[0]
  return {
    key: name.toLowerCase(),
    sources,
    active,
    name,
    installed: sources.some((s) => s.installed),
    favorite: false,
    sharedOrFree: sources.every((s) => s.sharedOrFree === true),
    playtimeMinutes: 120,
    lastPlayed: 1699500000,
    installPath: active.installPath,
    installSizeBytes: active.installSizeBytes,
    // Mandatory field: the tile reaches for it without checking. Missing,
    // the renderer crashed and the library stayed completely empty — which
    // is exactly what happened when the metadata went in, and exactly what
    // this smoke test caught.
    artwork,
    ...(metadata === undefined ? {} : { metadata })
  }
}

// Modelled on the real library, not on wishes: the longest description
// there is 11,920 characters and the maximum number of screenshots is 181.
// The page has to survive both without the layout breaking.
const META = {
  steamAppId: 298110,
  matchSource: 'steam-appid',
  shortDescription: 'Short description for the smoke test.',
  description: 'Paragraph one.\n\n'.repeat(400) + 'End.',
  developers: ['Ubisoft Montreal'],
  publishers: ['Ubisoft'],
  genres: ['Action', 'Adventure'],
  releaseDate: '18 Nov, 2014',
  metacritic: 82,
  screenshots: Array.from(
    { length: 181 },
    (_, i) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/298110/ss_${i}.jpg`
  ),
  fetchedAt: 1699500000,
  fetchAttempts: 0
}

// The two aspect ratios the sources actually supply: Steam's
// library_600x900 is 2:3, Epic's DieselGameBoxTall 3:4. As a data: URI, so
// the measurement holds without network and without waiting.
const svg = (w, h, colour) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" fill="${colour}"/></svg>`
  )
const IMAGE_STEAM = svg(600, 900, 'red')
const IMAGE_EPIC = svg(1200, 1600, 'blue')

// Real image URL from Epic's catalogue on the development machine — it
// doubles as a check that the CSP lets it through.
const IMAGE =
  'https://cdn1.epicgames.com/047392e91d5e4cfdb19e2767440ab206/item/' +
  'EGS_JurassicWorldEvolution_FrontierDevelopments_S2-1200x1600-' +
  'd132a04130d2fad11948e182046f50dc.jpg'

// Deliberately enough of them to overfill the window. With twelve entries
// two rows fit and the layout bug from plan 1 would stay invisible — it
// only appears once the content overflows the container. Do not reduce.
const entries = Array.from({ length: 200 }, (_, i) =>
  entry(`Test game with a somewhat longer name ${i}`, [
    source('steam', i, `Test game with a somewhat longer name ${i}`, i % 2 === 0)
  ])
)

// A merged entry with two sources — the real case (Far Cry 4 on Steam and
// Ubisoft). The store switch only appears for that, and only this way can
// it be checked.
entries.unshift(
  entry(
    'Far Cry 4',
    [source('steam', '298110', 'Far Cry 4', true), source('ubisoft', '856', 'Far Cry 4', false)],
    [
      { kind: 'grid', url: IMAGE },
      { kind: 'hero', url: IMAGE }
    ],
    META
  )
)

// Three tiles that together check the image heights: Steam portrait, Epic
// portrait and one without any image at all. All three have to be the same
// height — otherwise the grid is ragged, which is exactly how it looked to
// the user.
//
// Names deliberately at the end of the alphabet: the other checks measure
// the *first* tile and expect the merged Far Cry 4 entry there. The view
// sorts by name, not by array order — with "AAA" these tiles came first and
// the checks measured the wrong thing.
entries.push(
  entry('ZZA No image', [source('ea', 'empty', 'ZZA No image', true)]),
  // Neither installed nor licensed — checks the install button and the
  // shared badge on one tile.
  entry('ZZD Shared', [
    { ...source('steam', 'shared', 'ZZD Shared', false), sharedOrFree: true }
  ]),
  entry('ZZB Epic ratio', [source('epic', 'ep', 'ZZB Epic ratio', true)], [
    { kind: 'grid', url: IMAGE_EPIC }
  ]),
  entry('ZZC Steam ratio', [source('steam', 'st', 'ZZC Steam ratio', true)], [
    { kind: 'grid', url: IMAGE_STEAM }
  ])
)

contextBridge.exposeInMainWorld('arcadia', {
  getGames: async () => entries,
  sync: async () => ({ stores: [], totalGames: entries.length }),
  launch: async () => ({ ok: true }),
  // The way EA answers: opened yes, installed no.
  install: async () => ({
    ok: true,
    notice: 'EA Desktop cannot be driven to install from outside.'
  }),
  // `done: true`, or the first-run dialog would cover the library on every
  // smoke run and every measurement below it — tile heights, the store
  // popover, the scroll position — would fail at once. The gear opens the
  // same dialog, which is where the smoke test looks at it.
  getEnvConfig: async () => ({
    done: true,
    values: {
      STEAM_WEB_API_KEY: 'stub-steam-key',
      STEAM_ID64: '',
      STEAMGRIDDB_API_KEY: 'stub-grid-key'
    },
    path: 'C:\\Users\\smoke\\AppData\\Roaming\\arcadia\\.env'
  }),
  saveEnvConfig: async () => ({ ok: true, restarting: false }),
  setFavorite: async () => undefined,
  setPreferredStore: async () => undefined,
  setSplit: async () => undefined,
  openFolder: async () => ({ ok: true }),
  searchApps: async () => [
    { appId: 298110, name: 'Far Cry 4' },
    { appId: 298111, name: 'Far Cry 4 Gold Edition' }
  ],
  setMatch: async () => ({ ok: true }),
  // Asked for by LanguageProvider on mount, before anything is rendered.
  // Missing, the throw escapes a useEffect with no error boundary above it,
  // React tears the whole root down and every measurement below fails
  // against an empty document — which is how this file's absence presented:
  // not as "getLanguage is undefined" but as a null `.click()` target
  // several hundred lines later.
  getLanguage: async () => 'en',
  // The language menu calls this on every switch. Missing, the click would
  // throw inside the handler and the popover would simply not close.
  setLanguage: async () => undefined,
  // Every store enabled: matches the real default when nothing has been
  // chosen, which is what a first-run smoke test always is.
  getEnabledStores: async () => ['steam', 'epic', 'ea', 'ubisoft'],
  setEnabledStores: async () => undefined,
  // Every store reports available with no limitations: the smoke test's
  // fake bridge has no real adapters behind it, and "checking…" forever
  // would be a false failure signal for a screen this test does not open.
  getStoreAvailability: async () => ({
    steam: { available: true },
    epic: { available: true },
    ea: { available: true },
    ubisoft: { available: true }
  }),
  // DPAPI on the machine this smoke test runs on; the configuration
  // screen only warns when this is false.
  isSecureStorageAvailable: async () => true,
  // Sent when the install overlay is dismissed.
  cancelInstall: async () => undefined,
  // Adding does not really change the stub's list; the smoke test only
  // checks that the dialog opens, validates and submits.
  addManualGame: async () => ({ ok: true, id: 'ea:manual-added-by-hand' }),
  removeManualGame: async () => ({ ok: true }),
  reportBrokenArtwork: async () => undefined,
  // No scan is running: the stub's library is already complete, and a true
  // here would put the "searching…" hint on screen in place of the tiles
  // every measurement below depends on.
  isScanning: async () => false,
  onScanningChanged: () => () => undefined,
  onLibraryChanged: () => () => undefined,
  onNavigateBack: () => () => undefined,
  onNavigateForward: () => () => undefined,
  // No Microsoft session in the smoke stub: signed out, and a sign-in
  // attempt reports the platform reason a real handler would give when no
  // session was built.
  getMicrosoftAuth: async () => ({ signedIn: false }),
  signInToMicrosoft: async () => ({ ok: false, error: 'The Microsoft Store only exists on Windows.' }),
  signOutOfMicrosoft: async () => undefined,
  onMicrosoftAuthChanged: () => () => undefined
})
