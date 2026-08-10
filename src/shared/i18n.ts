/**
 * Every string the user reads inside the app window.
 *
 * Why a single file rather than literals at the point of use: the app is
 * split across two processes. Store adapters and IPC handlers live in the
 * main process and produce messages — "not installed", "no folder known" —
 * that surface in the renderer's banner. Scattering translations across
 * both sides would guarantee that one of them drifts.
 *
 * **Not covered here:** diagnostics that only ever reach the console — VDF
 * parse errors, HTTP failures while fetching Steam's app list. Those are
 * read by whoever is debugging, never by the person playing games, and
 * routing them through a translation table would add ceremony without
 * adding value.
 *
 * Parameterised strings are functions, not templates with placeholders.
 * That way the compiler catches a missing argument, and a translator
 * cannot silently drop one.
 */

export type Language = 'en' | 'de'

export interface Strings {
  /**
   * Locale-dependent formatting.
   *
   * `locale` feeds `localeCompare` and `toLocaleDateString`. It belongs
   * here and not next to the call sites: sorting German titles with an
   * English collator puts “Ärger” after “Zorn”, and a date rendered in the
   * wrong locale looks like a bug rather than a setting.
   */
  format: {
    locale: string
    minutes: (count: number) => string
    hours: (count: number) => string
  }

  common: {
    close: string
    cancel: string
    dismissMessage: string
    dismissHint: string
  }

  toolbar: {
    searchPlaceholder: string
    allStores: string
    storeFilterLabel: string
    /** From three stores on, where the names no longer fit the toolbar. */
    storesSelected: (count: number) => string
    /**
     * The trigger's tooltip, e.g. "Store: Steam, Epic, EA" — the selection
     * in full, which the label itself no longer shows once it counts.
     */
    storeFilterTitle: (selection: string) => string
    sortLabel: string
    sort: { name: string; playtime: string; lastPlayed: string; size: string }
    /** e.g. "Sort direction: ascending" — the toggle's accessible name. */
    sortDirectionLabel: (state: string) => string
    sortDirection: { asc: string; desc: string }
    onlyInstalled: string
    onlyFavorites: string
    sharedLabel: string
    shared: { all: string; only: string; exclude: string }
    viewLabel: string
    view: { grid: string; list: string }
    settingsLabel: string
    languageLabel: string
    language: { en: string; de: string }
    addGame: string
    /** e.g. "42 of 263" */
    shownOfTotal: (shown: number, total: number) => string
    refresh: string
    refreshing: string
  }

  addDialog: {
    label: string
    title: string
    hint: string
    nameLabel: string
    storeLabel: string
    /** Shown in place of the store list when every store is switched off. */
    noStores: string
    idLabel: string
    idHint: string
    submit: string
    cancel: string
  }

  /**
   * The configuration screen for the `.env` keys.
   *
   * The field hints are deliberately concrete about what is lost without a
   * key: "optional" alone tells nobody whether it is worth fetching one.
   */
  setup: {
    label: string
    title: string
    intro: string
    firstRunHint: string
    storesTitle: string
    storesHint: string
    storeChecking: string
    storeDetected: string
    storeNotFound: string
    microsoftSignIn: string
    /** Shown on the sign-in button itself while the device code is being requested, so a second click cannot start a second flow before the first has anything to show for it. */
    microsoftSigningIn: string
    microsoftSignOut: string
    microsoftSignedInAs: (gamertag: string) => string
    microsoftCodeHint: (code: string) => string
    microsoftOpenLink: string
    /** Shown where safeStorage reports it cannot encrypt anything. */
    microsoftNoEncryption: string
    /** e.g. "Saved to C:\Users\…\.env" */
    fileHint: (path: string) => string
    steamKeyLabel: string
    steamKeyHint: string
    steamIdLabel: string
    steamIdHint: string
    gridKeyLabel: string
    gridKeyHint: string
    whereToGet: string
    skip: string
    skipHint: string
    save: string
    saveAndRestart: string
    continueWithout: string
    restarting: string
    close: string
  }

  library: {
    loading: string
    /**
     * Shown while a scan is filling a library that is still empty — which on
     * a first start is the entire wait.
     */
    scanning: string
    empty: string
    noMatches: string
    /** Right-hand pane in list view with nothing selected. */
    nothingSelected: string
  }

  install: {
    /** e.g. "Installing through Steam" */
    overlayTitle: (store: string) => string
    overlayBody: (store: string) => string
    overlayDismiss: string
  }

  card: {
    play: string
    install: string
    notInstalled: string
    installVia: (store: string) => string
    addFavorite: string
    removeFavorite: string
    sharedOrFree: string
    sharedOrFreeTitle: string
  }

  storeSwitch: {
    launchVia: string
    launchViaStore: (store: string) => string
    notInstalledAtStore: (store: string) => string
    split: string
    splitTitle: string
  }

  detail: {
    back: string
    /** Only on hand-made entries; a scanned game cannot be deleted. */
    removeManual: string
    removeManualConfirm: string
    origin: string
    originShared: string
    playtime: string
    lastPlayed: string
    size: string
    store: string
    availableAt: string
    folder: string
    openInFileManager: string
    genres: string
    developers: string
    publishers: string
    released: string
    metacritic: string
    installed: string
    notInstalled: string
    enlargeScreenshot: string
    noMetadata: string
    fixMatch: string
    setMatch: string
  }

  matchDialog: {
    title: string
    label: string
    hint: string
    searchPlaceholder: string
    searching: string
    nothingFound: string
  }

  errors: {
    invalidGameId: string
    invalidKey: string
    invalidInput: string
    unknownGame: (gameId: string) => string
    unknownGameShort: string
    launchFailed: (detail: string) => string
    installFailed: (detail: string) => string
    noFolderKnown: string
    folderGone: (path: string) => string
    folderOpenFailed: (detail: string) => string
    matchFailed: (detail: string) => string
    matchSavedFetchFailed: string
    libraryLoadFailed: (detail: string) => string
    refreshFailed: (detail: string) => string
    /** e.g. "Setting favourite failed: disk full" */
    actionFailed: (action: string, detail: string) => string
    setFavourite: string
    saveStoreChoice: string
    saveSplit: string
    noAdapter: (storeId: string) => string
    /** The URI is included because a failure is untraceable without it. */
    launchUriFailed: (uri: string, detail: string) => string
    installUriFailed: (uri: string, detail: string) => string
    launchNameFailed: (name: string, detail: string) => string
    installNameFailed: (name: string, detail: string) => string
    /** The `.env` could not be written — read-only file, no permission. */
    envSaveFailed: (detail: string) => string
    /** The database was damaged and has been set aside; a fresh one took over. */
    databaseRecovered: (path: string) => string
    /** The database could not be opened at all, so this run keeps nothing. */
    databaseUnusable: (detail: string) => string
  }

  stores: {
    steam: {
      notFound: string
      noApiKey: string
      apiKeyRejected: string
      unreachable: string
      unexpectedStatus: (status: number) => string
      invalidJson: string
      unexpectedShape: string
      privateProfile: string
      libraryFailed: string
      invalidAppId: (id: string) => string
      /** Shown when the install was fired but no dialog ever appeared. */
      noInstallDialog: string
    }
    epic: {
      notFound: string
      onlyInstalled: string
      catalogCacheMissing: string
      notInstalledCannotLaunch: (name: string) => string
      noCatalogId: (name: string) => string
    }
    ea: {
      notFound: string
      ownedFromLocalStore: string
      namesFromCatalog: string
      installStateHeuristic: string
      installNotice: string
      invalidOfferId: (id: string) => string
      catalogUnreachable: string
      catalogHttpError: (status: number) => string
      catalogUnreadable: string
    }
    ubisoft: {
      notFound: string
      ownedFromLocalCache: string
      invalidGameId: (id: string) => string
    }
    microsoft: {
      windowsOnly: string
      noPlaytime: string
      noInstallSize: string
      signedOutOnlyXboxApp: string
      notInstalledCannotLaunch: (name: string) => string
      noProductId: (name: string) => string
      signInFailed: (reason: string) => string
      signInExpired: string
      signInDeclined: string
      signInCancelled: string
      xboxAuthFailed: (reason: string) => string
      noXboxProfile: string
      childAccount: string
      titleHistoryFailed: (reason: string) => string
      missingXuid: string
      catalogFailed: (reason: string) => string
    }
  }
}

const en: Strings = {
  format: {
    locale: 'en-GB',
    minutes: (count) => `${count} min`,
    hours: (count) => `${count} h`
  },

  common: {
    close: 'Close',
    cancel: 'Cancel',
    dismissMessage: 'Dismiss message',
    dismissHint: 'Dismiss hint'
  },

  toolbar: {
    searchPlaceholder: 'Search library…',
    allStores: 'All stores',
    storeFilterLabel: 'Store',
    storesSelected: (count) => `${count} stores`,
    storeFilterTitle: (selection) => `Store: ${selection}`,
    sortLabel: 'Sorting',
    sort: {
      name: 'Name',
      playtime: 'Playtime',
      lastPlayed: 'Last played',
      size: 'Size'
    },
    sortDirectionLabel: (state) => `Sort direction: ${state}`,
    sortDirection: { asc: 'ascending', desc: 'descending' },
    onlyInstalled: 'Installed only',
    onlyFavorites: 'Favourites only',
    sharedLabel: 'Licence',
    shared: {
      all: 'All games',
      only: 'Shared/free only',
      exclude: 'Licensed only'
    },
    viewLabel: 'View',
    view: { grid: 'Grid', list: 'List' },
    settingsLabel: 'Settings',
    languageLabel: 'Language',
    language: { en: 'English', de: 'Deutsch' },
    addGame: 'Add game',
    shownOfTotal: (shown, total) => `${shown} of ${total}`,
    refresh: 'Refresh',
    refreshing: 'Scanning…'
  },

  addDialog: {
    label: 'Add a game by hand',
    title: 'Add a game',
    hint:
      'For games no store reports — EA only lists what has been installed on ' +
      'this machine.',
    nameLabel: 'Name',
    storeLabel: 'Store',
    noStores:
      'No store is switched on. Switch one on under Stores in the ' +
      'configuration screen, then add the game.',
    idLabel: 'Store ID (optional)',
    idHint:
      'Leave empty if you do not know it. The entry then gets artwork and a ' +
      'description, but cannot be launched.',
    submit: 'Add',
    cancel: 'Cancel'
  },

  setup: {
    label: 'Configure API keys',
    title: 'Configuration',
    intro:
      'All three are optional. Without them Arcadia still finds everything ' +
      'discoverable on this machine — installed Steam games, Epic’s ' +
      'catalogue, EA and Ubisoft from the registry.',
    firstRunHint:
      'You will only be asked once. The gear in the toolbar reopens this at ' +
      'any time.',
    storesTitle: 'Stores',
    storesHint:
      'Only the ticked stores are searched, and only they appear in the ' +
      'store filter. Games from a store you switch off are hidden, not ' +
      'deleted — switching it back on brings them straight back.',
    storeChecking: 'checking…',
    storeDetected: 'found on this machine',
    storeNotFound: 'not found on this machine',
    microsoftSignIn: 'Connect a Microsoft account',
    microsoftSigningIn: 'Connecting…',
    microsoftSignOut: 'Disconnect',
    microsoftSignedInAs: (gamertag) => `Signed in as ${gamertag}`,
    microsoftCodeHint: (code) => `Enter the code ${code} in your browser:`,
    microsoftOpenLink: 'Open the sign-in page',
    microsoftNoEncryption:
      'This system offers no keyring, so the Microsoft sign-in is stored ' +
      'unencrypted in Arcadia’s database. The file sits in your own user ' +
      'profile; anyone who can read it can read the token.',
    fileHint: (path) => `Stored in ${path}`,
    steamKeyLabel: 'Steam Web API key',
    steamKeyHint:
      'Without it: installed Steam games only — no owned library, no ' +
      'playtime, and no name matching for games from other stores.',
    steamIdLabel: 'SteamID64 (optional)',
    steamIdHint:
      'Only needed when several Steam accounts live on this machine and the ' +
      'wrong one is picked. Otherwise Arcadia reads the most recent login.',
    gridKeyLabel: 'SteamGridDB API key',
    gridKeyHint:
      'Artwork for games whose store page is gone — test branches, ' +
      'discontinued and older titles. Without it: no error, just fewer images.',
    whereToGet: 'Where to get one',
    skip: 'Skip configuration',
    skipHint: 'Arcadia starts without keys. Nothing already in the file is changed.',
    save: 'Save',
    saveAndRestart: 'Save and restart',
    continueWithout: 'Continue without keys',
    restarting: 'Restarting…',
    close: 'Close'
  },

  library: {
    loading: 'Loading library…',
    scanning: 'Searching Steam, Epic, EA and Ubisoft for your games…',
    empty: 'No games found yet. “Refresh” starts the scan.',
    noMatches: 'No game matches the current filters.',
    nothingSelected: 'Pick a game from the list.'
  },

  install: {
    overlayTitle: (store) => `Installing through ${store}`,
    overlayBody: (store) => `The ${store} dialog handles this step. Arcadia is waiting for it.`,
    overlayDismiss: 'Press Esc to keep browsing'
  },

  card: {
    play: 'Play',
    install: 'Install',
    notInstalled: 'Not installed',
    installVia: (store) => `Install via ${store}`,
    addFavorite: 'Mark as favourite',
    removeFavorite: 'Remove favourite',
    sharedOrFree: 'Shared/Free',
    sharedOrFreeTitle: 'Not licensed to your account'
  },

  storeSwitch: {
    launchVia: 'Launch via:',
    launchViaStore: (store) => `Launch via ${store}`,
    notInstalledAtStore: (store) => `${store} — not installed there`,
    split: 'split',
    splitTitle: 'Show as two separate games'
  },

  detail: {
    back: '← Back to library',
    removeManual: 'Remove from library',
    removeManualConfirm: 'Remove this hand-made entry from the library?',
    origin: 'Origin',
    originShared: 'Not licensed to your account — family sharing or free-to-play',
    playtime: 'Playtime',
    lastPlayed: 'Last played',
    size: 'Size',
    store: 'Store',
    availableAt: 'Available at',
    folder: 'Folder',
    openInFileManager: 'Show in file manager',
    genres: 'Genres',
    developers: 'Developers',
    publishers: 'Publishers',
    released: 'Released',
    metacritic: 'Metacritic',
    installed: 'Installed',
    notInstalled: 'Not installed',
    enlargeScreenshot: 'Enlarge screenshot',
    noMetadata:
      'No details available for this game yet. They are fetched in the ' +
      'background — or you can match it by hand below.',
    fixMatch: 'Wrong game matched?',
    setMatch: 'Match this game by hand'
  },

  matchDialog: {
    title: 'Which game is this?',
    label: 'Match game',
    hint:
      'Searches Steam’s app list. Your choice sticks and is never ' +
      'overwritten by the automatic matching.',
    searchPlaceholder: 'Type a title…',
    searching: 'Searching…',
    nothingFound:
      'Nothing found. Has the app list finished loading? It arrives shortly after startup.'
  },

  errors: {
    invalidGameId: 'Invalid game ID.',
    invalidKey: 'Invalid key.',
    invalidInput: 'Invalid input.',
    unknownGame: (gameId) => `Game ${gameId} is not known.`,
    unknownGameShort: 'Game is not known.',
    launchFailed: (detail) => `Launch failed: ${detail}`,
    installFailed: (detail) => `Install failed: ${detail}`,
    noFolderKnown: 'No folder is known for this game.',
    folderGone: (path) => `The folder no longer exists: ${path}`,
    folderOpenFailed: (detail) => `Could not open the folder: ${detail}`,
    matchFailed: (detail) => `Matching failed: ${detail}`,
    matchSavedFetchFailed: 'The match was saved, but fetching the details failed.',
    libraryLoadFailed: (detail) => `Could not load the library: ${detail}`,
    refreshFailed: (detail) => `Refresh failed: ${detail}`,
    actionFailed: (action, detail) => `${action} failed: ${detail}`,
    setFavourite: 'Setting favourite',
    saveStoreChoice: 'Saving store choice',
    saveSplit: 'Saving split',
    noAdapter: (storeId) => `No adapter for store "${storeId}".`,
    launchUriFailed: (uri, detail) => `Launch via ${uri} failed: ${detail}`,
    installUriFailed: (uri, detail) => `Install via ${uri} failed: ${detail}`,
    launchNameFailed: (name, detail) => `Launching “${name}” failed: ${detail}`,
    installNameFailed: (name, detail) => `Installing “${name}” failed: ${detail}`,
    envSaveFailed: (detail) => `The settings could not be saved: ${detail}`,
    databaseRecovered: (path) =>
      'Arcadia’s database was damaged and had to be started over, so the ' +
      'library is being scanned again. Nothing was deleted — the old file is ' +
      `still there as ${path}.`,
    databaseUnusable: (detail) =>
      `The database could not be opened (${detail}). Arcadia is running, but ` +
      'nothing it finds will be kept when you close it.'
  },

  stores: {
    steam: {
      notFound: 'Steam was not found on this system.',
      noApiKey:
        'Without a Steam Web API key only installed games are shown — ' +
        'no owned games and no playtime.',
      apiKeyRejected: 'The Steam Web API key was rejected. Please check it in the settings.',
      unreachable: 'Steam is unreachable.',
      unexpectedStatus: (status) => `Steam answered unexpectedly with HTTP ${status}.`,
      invalidJson: 'Steam did not return valid JSON.',
      unexpectedShape: 'Steam returned an unexpected response shape.',
      privateProfile:
        'Your Steam profile does not disclose game details. Set “Game details” ' +
        'to “Public” in Steam’s privacy settings.',
      libraryFailed: 'The Steam library could not be loaded.',
      invalidAppId: (id) => `Invalid Steam AppID: ${id}`,
      noInstallDialog:
        'Steam did not open an install dialog. It ignores a repeat request for the ' +
        'same game shortly after the first, so if you just opened one, give it a ' +
        'moment. Otherwise check the Steam window — it may not be offering this ' +
        'game, or may be waiting for you to sign in.'
    },
    epic: {
      notFound:
        'The Epic Games Launcher was not found on this system. ' +
        'There is no native Linux build.',
      onlyInstalled: 'Only installed games are shown.',
      catalogCacheMissing:
        'Epic’s catalogue cache was not found — only installed games are ' +
        'shown. Starting the Epic Games Launcher once creates it.',
      notInstalledCannotLaunch: (name) =>
        `“${name}” is not installed via Epic and cannot be launched.`,
      noCatalogId: (name) =>
        `Epic’s catalogue holds no identifier for “${name}” — please install it ` +
        'from the Epic Games Launcher.'
    },
    ea: {
      notFound: 'The EA app was not found on this system. There is no native Linux client.',
      ownedFromLocalStore:
        'The owned library is read from EA Desktop’s own local data and reflects ' +
        'the last time the EA app signed in here.',
      namesFromCatalog:
        'Names for games that are not installed come from EA’s catalogue service ' +
        'and need a connection; games it does not name are left out.',
      installStateHeuristic:
        'Install state is derived by matching names across two registry trees and ' +
        'may be missing in individual cases.',
      installNotice:
        'EA Desktop cannot be driven to install from outside — Arcadia opened your ' +
        'EA library, carry on from there.',
      invalidOfferId: (id) => `Invalid EA offer ID: ${id}`,
      catalogUnreachable: 'EA’s catalogue is unreachable.',
      catalogHttpError: (status) => `EA’s catalogue answered with HTTP ${status}.`,
      catalogUnreadable: 'EA’s catalogue returned an unexpected answer.'
    },
    ubisoft: {
      notFound: 'Ubisoft Connect was not found on this system. There is no native Linux client.',
      ownedFromLocalCache:
        'The owned library and the game names come from Ubisoft Connect’s own ' +
        'local caches and reflect the last time it signed in; a game it does ' +
        'not name is left out.',
      invalidGameId: (id) => `Invalid Ubisoft game ID: ${id}`
    },
    microsoft: {
      windowsOnly: 'The Microsoft Store only exists on Windows.',
      noPlaytime: 'Xbox reports no playtime, only when a game was last played.',
      noInstallSize: 'The install size of a Store game is not reported.',
      signedOutOnlyXboxApp:
        'Without a Microsoft account only games installed through the Xbox ' +
        'app are shown — a local scan cannot otherwise tell a game from an ' +
        'application.',
      notInstalledCannotLaunch: (name) =>
        `${name} is not installed, so there is nothing to start.`,
      noProductId: (name) =>
        `Arcadia does not know the Store product for ${name}, so it cannot ` +
        `open its page. Sign in with a Microsoft account, or install it from ` +
        `the Xbox app.`,
      signInFailed: (reason) => `The Microsoft sign-in failed: ${reason}`,
      signInExpired: 'The sign-in code expired before it was used. Please try again.',
      signInDeclined: 'The sign-in was declined.',
      signInCancelled: 'The sign-in was cancelled.',
      xboxAuthFailed: (reason) => `Xbox Live refused the sign-in: ${reason}`,
      noXboxProfile:
        'This Microsoft account has no Xbox profile. Sign in once at xbox.com ' +
        'to create one, then try again.',
      childAccount:
        'This account is a child account and has to be added to a family ' +
        'before it can use Xbox Live.',
      titleHistoryFailed: (reason) => `The Xbox title history could not be read: ${reason}`,
      missingXuid:
        'Xbox Live did not return a player ID for this account, so the title history ' +
        'cannot be read.',
      catalogFailed: (reason) => `The Microsoft Store catalogue could not be read: ${reason}`
    }
  }
}

/**
 * German — the language the project was originally written in.
 *
 * Kept complete rather than as a stub: every string below already existed
 * before the translation to English, so filling this bundle cost nothing
 * and makes the switch real instead of merely possible.
 */
const de: Strings = {
  format: {
    locale: 'de-DE',
    minutes: (count) => `${count} Min.`,
    hours: (count) => `${count} Std.`
  },

  common: {
    close: 'Schließen',
    cancel: 'Abbrechen',
    dismissMessage: 'Meldung schließen',
    dismissHint: 'Hinweis schließen'
  },

  toolbar: {
    searchPlaceholder: 'Bibliothek durchsuchen…',
    allStores: 'Alle Stores',
    storeFilterLabel: 'Store',
    storesSelected: (count) => `${count} Stores`,
    storeFilterTitle: (selection) => `Store: ${selection}`,
    sortLabel: 'Sortierung',
    sort: {
      name: 'Name',
      playtime: 'Spielzeit',
      lastPlayed: 'Zuletzt gespielt',
      size: 'Größe'
    },
    sortDirectionLabel: (state) => `Sortierrichtung: ${state}`,
    sortDirection: { asc: 'aufsteigend', desc: 'absteigend' },
    onlyInstalled: 'Nur installierte',
    onlyFavorites: 'Nur Favoriten',
    sharedLabel: 'Lizenz',
    shared: {
      all: 'Alle Spiele',
      only: 'Nur geteilte/gratis',
      exclude: 'Nur lizenzierte'
    },
    viewLabel: 'Ansicht',
    view: { grid: 'Kacheln', list: 'Liste' },
    settingsLabel: 'Einstellungen',
    languageLabel: 'Sprache',
    language: { en: 'English', de: 'Deutsch' },
    addGame: 'Spiel hinzufügen',
    shownOfTotal: (shown, total) => `${shown} von ${total}`,
    refresh: 'Aktualisieren',
    refreshing: 'Suche…'
  },

  addDialog: {
    label: 'Spiel von Hand hinzufügen',
    title: 'Spiel hinzufügen',
    hint:
      'Für Spiele, die kein Store meldet — EA listet nur, was auf diesem ' +
      'Rechner installiert war.',
    nameLabel: 'Name',
    storeLabel: 'Store',
    noStores:
      'Es ist kein Store eingeschaltet. Schalte in der Konfiguration unter ' +
      'Stores einen ein und füge das Spiel dann hinzu.',
    idLabel: 'Store-ID (optional)',
    idHint:
      'Leer lassen, wenn du sie nicht kennst. Der Eintrag bekommt dann Bild ' +
      'und Beschreibung, lässt sich aber nicht starten.',
    submit: 'Hinzufügen',
    cancel: 'Abbrechen'
  },

  setup: {
    label: 'API-Schlüssel einrichten',
    title: 'Konfiguration',
    intro:
      'Alle drei sind optional. Ohne sie findet Arcadia weiterhin alles, was ' +
      'auf diesem Rechner auffindbar ist — installierte Steam-Spiele, Epics ' +
      'Katalog, EA und Ubisoft aus der Registry.',
    firstRunHint:
      'Du wirst nur einmal gefragt. Das Zahnrad in der Leiste öffnet das ' +
      'hier jederzeit wieder.',
    storesTitle: 'Stores',
    storesHint:
      'Nur die angehakten Stores werden durchsucht, und nur sie erscheinen ' +
      'im Store-Filter. Spiele eines abgeschalteten Stores werden ' +
      'ausgeblendet, nicht gelöscht — beim Wiedereinschalten sind sie ' +
      'sofort zurück.',
    storeChecking: 'wird geprüft …',
    storeDetected: 'auf diesem Rechner gefunden',
    storeNotFound: 'auf diesem Rechner nicht gefunden',
    microsoftSignIn: 'Microsoft-Konto verbinden',
    microsoftSigningIn: 'Verbindung wird hergestellt…',
    microsoftSignOut: 'Trennen',
    microsoftSignedInAs: (gamertag) => `Angemeldet als ${gamertag}`,
    microsoftCodeHint: (code) => `Gib den Code ${code} im Browser ein:`,
    microsoftOpenLink: 'Anmeldeseite öffnen',
    microsoftNoEncryption:
      'Dieses System bietet keinen Schlüsselbund, daher wird die ' +
      'Microsoft-Anmeldung unverschlüsselt in Arcadias Datenbank ' +
      'gespeichert. Die Datei liegt in deinem eigenen Benutzerprofil; wer ' +
      'sie lesen kann, kann auch das Token lesen.',
    fileHint: (path) => `Gespeichert in ${path}`,
    steamKeyLabel: 'Steam-Web-API-Schlüssel',
    steamKeyHint:
      'Ohne ihn: nur installierte Steam-Spiele — keine gekaufte Bibliothek, ' +
      'keine Spielzeit und keine Namenszuordnung für Spiele anderer Stores.',
    steamIdLabel: 'SteamID64 (optional)',
    steamIdHint:
      'Nur nötig, wenn mehrere Steam-Konten auf diesem Rechner liegen und ' +
      'das falsche gewählt wird. Sonst liest Arcadia die letzte Anmeldung.',
    gridKeyLabel: 'SteamGridDB-API-Schlüssel',
    gridKeyHint:
      'Bilder für Spiele, deren Store-Seite es nicht mehr gibt — ' +
      'Test-Branches, eingestellte und ältere Titel. Ohne ihn: kein Fehler, ' +
      'nur weniger Bilder.',
    whereToGet: 'Wo es den gibt',
    skip: 'Konfiguration überspringen',
    skipHint: 'Arcadia startet ohne Schlüssel. Vorhandene Werte bleiben unangetastet.',
    save: 'Speichern',
    saveAndRestart: 'Speichern und neu starten',
    continueWithout: 'Ohne Schlüssel fortfahren',
    restarting: 'Neustart…',
    close: 'Schließen'
  },

  library: {
    loading: 'Bibliothek wird geladen…',
    scanning: 'Steam, Epic, EA und Ubisoft werden nach deinen Spielen durchsucht…',
    empty: 'Noch keine Spiele gefunden. „Aktualisieren“ startet die Suche.',
    noMatches: 'Kein Spiel passt zu den aktuellen Filtern.',
    nothingSelected: 'Wähle ein Spiel aus der Liste.'
  },

  install: {
    overlayTitle: (store) => `Installation über ${store}`,
    overlayBody: (store) => `Diesen Schritt übernimmt der ${store}-Dialog. Arcadia wartet darauf.`,
    overlayDismiss: 'Zum Weiterstöbern Esc drücken'
  },

  card: {
    play: 'Spielen',
    install: 'Installieren',
    notInstalled: 'Nicht installiert',
    installVia: (store) => `Über ${store} installieren`,
    addFavorite: 'Als Favorit markieren',
    removeFavorite: 'Favorit entfernen',
    sharedOrFree: 'Geteilt/Gratis',
    sharedOrFreeTitle: 'Nicht deinem Konto lizenziert'
  },

  storeSwitch: {
    launchVia: 'Starten über:',
    launchViaStore: (store) => `Über ${store} starten`,
    notInstalledAtStore: (store) => `${store} — dort nicht installiert`,
    split: 'trennen',
    splitTitle: 'Als zwei getrennte Spiele anzeigen'
  },

  detail: {
    back: '← Zurück zur Bibliothek',
    removeManual: 'Aus der Bibliothek entfernen',
    removeManualConfirm: 'Diesen selbst angelegten Eintrag aus der Bibliothek entfernen?',
    origin: 'Herkunft',
    originShared: 'Nicht deinem Konto lizenziert — Familienfreigabe oder gratis',
    playtime: 'Spielzeit',
    lastPlayed: 'Zuletzt gespielt',
    size: 'Größe',
    store: 'Store',
    availableAt: 'Verfügbar bei',
    folder: 'Ordner',
    openInFileManager: 'Im Dateimanager öffnen',
    genres: 'Genres',
    developers: 'Entwickler',
    publishers: 'Publisher',
    released: 'Erschienen',
    metacritic: 'Metacritic',
    installed: 'Installiert',
    notInstalled: 'Nicht installiert',
    enlargeScreenshot: 'Screenshot vergrößern',
    noMetadata:
      'Für dieses Spiel liegen noch keine Angaben vor. Sie werden im ' +
      'Hintergrund geholt — oder du ordnest es unten von Hand zu.',
    fixMatch: 'Falsches Spiel zugeordnet?',
    setMatch: 'Spiel von Hand zuordnen'
  },

  matchDialog: {
    title: 'Welches Spiel ist das?',
    label: 'Spiel zuordnen',
    hint:
      'Gesucht wird in Steams App-Liste. Die Auswahl bleibt bestehen und wird ' +
      'von der automatischen Zuordnung nicht überschrieben.',
    searchPlaceholder: 'Titel eingeben…',
    searching: 'Wird gesucht…',
    nothingFound:
      'Nichts gefunden. Ist die App-Liste schon geladen? Sie kommt kurz nach dem Start.'
  },

  errors: {
    invalidGameId: 'Ungültige Spiel-ID.',
    invalidKey: 'Ungültiger Schlüssel.',
    invalidInput: 'Ungültige Eingabe.',
    unknownGame: (gameId) => `Spiel ${gameId} ist nicht bekannt.`,
    unknownGameShort: 'Spiel ist nicht bekannt.',
    launchFailed: (detail) => `Start fehlgeschlagen: ${detail}`,
    installFailed: (detail) => `Installation fehlgeschlagen: ${detail}`,
    noFolderKnown: 'Für dieses Spiel ist kein Ordner bekannt.',
    folderGone: (path) => `Der Ordner existiert nicht mehr: ${path}`,
    folderOpenFailed: (detail) => `Ordner konnte nicht geöffnet werden: ${detail}`,
    matchFailed: (detail) => `Zuordnung fehlgeschlagen: ${detail}`,
    matchSavedFetchFailed: 'Die Zuordnung ist gespeichert, der Abruf schlug fehl.',
    libraryLoadFailed: (detail) => `Bibliothek konnte nicht geladen werden: ${detail}`,
    refreshFailed: (detail) => `Aktualisieren fehlgeschlagen: ${detail}`,
    actionFailed: (action, detail) => `${action} fehlgeschlagen: ${detail}`,
    setFavourite: 'Favorit setzen',
    saveStoreChoice: 'Store-Wahl speichern',
    saveSplit: 'Trennung speichern',
    noAdapter: (storeId) => `Kein Adapter für Store "${storeId}" vorhanden.`,
    launchUriFailed: (uri, detail) => `Start über ${uri} fehlgeschlagen: ${detail}`,
    installUriFailed: (uri, detail) => `Installation über ${uri} fehlgeschlagen: ${detail}`,
    launchNameFailed: (name, detail) => `Start von „${name}“ fehlgeschlagen: ${detail}`,
    installNameFailed: (name, detail) => `Installation von „${name}“ fehlgeschlagen: ${detail}`,
    envSaveFailed: (detail) => `Die Einstellungen konnten nicht gespeichert werden: ${detail}`,
    databaseRecovered: (path) =>
      'Arcadias Datenbank war beschädigt und musste neu angelegt werden, daher ' +
      'wird die Bibliothek erneut eingelesen. Gelöscht wurde nichts — die alte ' +
      `Datei liegt weiterhin unter ${path}.`,
    databaseUnusable: (detail) =>
      `Die Datenbank konnte nicht geöffnet werden (${detail}). Arcadia läuft, ` +
      'aber nichts davon wird beim Beenden gespeichert.'
  },

  stores: {
    steam: {
      notFound: 'Steam wurde auf diesem System nicht gefunden.',
      noApiKey:
        'Ohne Steam Web API Key werden nur installierte Spiele angezeigt — ' +
        'keine gekauften und keine Spielzeit.',
      apiKeyRejected:
        'Der Steam Web API Key wurde abgelehnt. Bitte in den Einstellungen prüfen.',
      unreachable: 'Steam ist nicht erreichbar.',
      unexpectedStatus: (status) => `Steam antwortete unerwartet mit HTTP ${status}.`,
      invalidJson: 'Steam lieferte keine gültige JSON-Antwort.',
      unexpectedShape: 'Steam lieferte eine unerwartete Antwortstruktur.',
      privateProfile:
        'Dein Steam-Profil gibt die Spieldetails nicht preis. Stelle in den ' +
        'Steam-Privatsphäre-Einstellungen „Spieldetails“ auf „Öffentlich“.',
      libraryFailed: 'Die Steam-Bibliothek konnte nicht geladen werden.',
      invalidAppId: (id) => `Ungültige Steam-AppID: ${id}`,
      noInstallDialog:
        'Steam hat keinen Installationsdialog geöffnet. Eine erneute Anfrage für ' +
        'dasselbe Spiel ignoriert Steam kurz nach der ersten — wenn du gerade einen ' +
        'Dialog geöffnet hast, warte einen Moment. Andernfalls bitte im ' +
        'Steam-Fenster nachsehen: Vielleicht bietet Steam dieses Spiel nicht an ' +
        'oder wartet auf eine Anmeldung.'
    },
    epic: {
      notFound:
        'Der Epic Games Launcher wurde auf diesem System nicht gefunden. ' +
        'Unter Linux gibt es ihn nicht nativ.',
      onlyInstalled: 'Es werden nur installierte Spiele angezeigt.',
      catalogCacheMissing:
        'Epics Katalog-Zwischenspeicher wurde nicht gefunden — es werden nur ' +
        'installierte Spiele angezeigt. Ein Start des Epic Games Launchers legt ihn an.',
      notInstalledCannotLaunch: (name) =>
        `„${name}“ ist bei Epic nicht installiert und kann nicht gestartet werden.`,
      noCatalogId: (name) =>
        `Für „${name}“ liefert Epics Katalog keine Kennung — bitte im Epic Games ` +
        'Launcher installieren.'
    },
    ea: {
      notFound:
        'Die EA App wurde auf diesem System nicht gefunden. ' +
        'Unter Linux gibt es keinen nativen Client.',
      ownedFromLocalStore:
        'Die gekaufte Bibliothek stammt aus den lokalen Daten von EA Desktop und ' +
        'entspricht dem Stand der letzten Anmeldung der EA App auf diesem Rechner.',
      namesFromCatalog:
        'Namen für nicht installierte Spiele kommen aus EAs Katalogdienst und ' +
        'brauchen eine Verbindung; was er nicht benennt, bleibt außen vor.',
      installStateHeuristic:
        'Der Installationsstatus wird über einen Namensabgleich zwischen zwei ' +
        'Registry-Bäumen ermittelt und kann in Einzelfällen fehlen.',
      installNotice:
        'EA Desktop lässt sich von außen nicht zum Installieren bewegen — ' +
        'Arcadia hat deine EA-Bibliothek geöffnet, dort geht es weiter.',
      invalidOfferId: (id) => `Unzulässige EA-Angebots-ID: ${id}`,
      catalogUnreachable: 'EAs Katalog ist nicht erreichbar.',
      catalogHttpError: (status) => `EAs Katalog hat mit HTTP ${status} geantwortet.`,
      catalogUnreadable: 'EAs Katalog hat unerwartet geantwortet.'
    },
    ubisoft: {
      notFound:
        'Ubisoft Connect wurde auf diesem System nicht gefunden. ' +
        'Unter Linux gibt es keinen nativen Client.',
      ownedFromLocalCache:
        'Die gekaufte Bibliothek und die Spielnamen stammen aus den lokalen ' +
        'Zwischenspeichern von Ubisoft Connect und entsprechen dem Stand der ' +
        'letzten Anmeldung; ein Spiel ohne Namen bleibt außen vor.',
      invalidGameId: (id) => `Unzulässige Ubisoft-Spiel-ID: ${id}`
    },
    microsoft: {
      windowsOnly: 'Den Microsoft Store gibt es nur unter Windows.',
      noPlaytime: 'Xbox meldet keine Spielzeit, nur wann zuletzt gespielt wurde.',
      noInstallSize: 'Die Installationsgröße eines Store-Spiels wird nicht gemeldet.',
      signedOutOnlyXboxApp:
        'Ohne Microsoft-Konto werden nur Spiele angezeigt, die über die ' +
        'Xbox-App installiert wurden — lokal lässt sich ein Spiel sonst ' +
        'nicht von einer Anwendung unterscheiden.',
      notInstalledCannotLaunch: (name) =>
        `${name} ist nicht installiert, es gibt also nichts zu starten.`,
      noProductId: (name) =>
        `Arcadia kennt das Store-Produkt zu ${name} nicht und kann die Seite ` +
        `daher nicht öffnen. Melde dich mit einem Microsoft-Konto an oder ` +
        `installiere es über die Xbox-App.`,
      signInFailed: (reason) => `Die Microsoft-Anmeldung ist fehlgeschlagen: ${reason}`,
      signInExpired: 'Der Anmeldecode ist abgelaufen, bevor er benutzt wurde. Bitte erneut versuchen.',
      signInDeclined: 'Die Anmeldung wurde abgelehnt.',
      signInCancelled: 'Die Anmeldung wurde abgebrochen.',
      xboxAuthFailed: (reason) => `Xbox Live hat die Anmeldung abgelehnt: ${reason}`,
      noXboxProfile:
        'Dieses Microsoft-Konto hat kein Xbox-Profil. Melde dich einmal auf ' +
        'xbox.com an, um eines anzulegen, und versuche es dann erneut.',
      childAccount:
        'Dieses Konto ist ein Kinderkonto und muss erst einer Familie ' +
        'hinzugefügt werden, bevor es Xbox Live nutzen kann.',
      titleHistoryFailed: (reason) =>
        `Der Xbox-Spielverlauf konnte nicht gelesen werden: ${reason}`,
      missingXuid:
        'Xbox Live hat für dieses Konto keine Spieler-ID zurückgegeben, daher kann der ' +
        'Spielverlauf nicht gelesen werden.',
      catalogFailed: (reason) =>
        `Der Microsoft-Store-Katalog konnte nicht gelesen werden: ${reason}`
    }
  }
}

export const BUNDLES: Record<Language, Strings> = { en, de }

/** Offered in the settings menu, in this order. */
export const LANGUAGES: readonly Language[] = ['en', 'de']

export const DEFAULT_LANGUAGE: Language = 'en'

/**
 * Validates a language read from outside — the settings table, an IPC
 * message.
 *
 * Both sources can carry anything: the table is a plain file a user can
 * edit, and an older or newer version of the app could have written a value
 * this one does not know. Without the check the value would reach
 * `BUNDLES[value]`, yield `undefined`, and every string in the interface
 * would render as blank with no error to explain it.
 */
export function parseLanguage(value: unknown): Language | undefined {
  return value === 'en' || value === 'de' ? value : undefined
}

/**
 * Held per process, not shared.
 *
 * Main and renderer are separate JavaScript realms; each keeps its own
 * copy. Switching at runtime therefore means telling both — which is why
 * there is no setter wired to the UI yet. Everything below the surface is
 * ready for one.
 */
let current: Language = DEFAULT_LANGUAGE

export function setLanguage(language: Language): void {
  current = language
}

export function getLanguage(): Language {
  return current
}

/** The active bundle. Written as a call so it re-reads after a switch. */
export function t(): Strings {
  return BUNDLES[current]
}
