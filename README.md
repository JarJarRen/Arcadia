# Arcadia

One library for **Steam, Epic Games, EA and Ubisoft** — on Windows and Linux. Shows owned and installed games in a single grid, launches them through their own launcher, and gives every game a details page with description, screenshots and the local facts no store supplies: playtime, install size, path.

Electron + React + TypeScript. Persistence through `node:sqlite`, with no native modules — there is nothing to compile.

---

## Requirements

| | |
|---|---|
| **Node.js ≥ 24** | Mandatory. Arcadia uses `node:sqlite`, which is only available without a flag from Node 24 onwards. On Node 20 or 22 even the first test fails. |
| Git | to check it out |

No compiler and no Python are needed. That was the reason against `better-sqlite3`: its installation calls `node-gyp` with no fallback.

---

## Installing

Download **`Arcadia-Setup-<version>.exe`** from the releases page and run it. It
installs for the current user — no administrator rights — and puts Arcadia in
the Start menu, from where it can be pinned to the taskbar. There is also
**`Arcadia-<version>-portable.exe`**, a single file that runs without
installing anything.

> **Windows will warn you the first time.** The executables are not code-signed
> — a certificate costs money and this is a hobby project — so SmartScreen shows
> "Windows protected your PC". *More info* → *Run anyway*. That warning is about
> the missing signature, not about anything found in the file.

Nothing else is required. Everything Arcadia writes — the database, the cached
Steam app list — goes to `%APPDATA%\arcadia`.

### API keys, once installed

Both are optional; without them Arcadia shows only what it can find locally.
To add them, create a file called `.env` in `%APPDATA%\arcadia` (the same
folder as `arcadia.db`) with the contents of [`.env.example`](.env.example).

There is no settings dialog for this yet. It is the obvious next thing.

---

## Building it yourself

```bash
git clone <repo> arcadia
cd arcadia
npm ci
cp .env.example .env      # Windows: copy .env.example .env
npm run dist              # installer + portable exe in release/
```

### If `npm ci` blocks the install scripts

Newer npm versions (11 and up) no longer run `postinstall` unasked. The output then looks like this:

```
npm warn allow-scripts   esbuild@0.28.1 (postinstall: node install.js)
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review
```

The consequence: Electron's binary is missing. `npm test` and `npm run typecheck` still run, and `npm run dev` downloads it on first start — but that needs a network connection. Cleaner is:

```bash
npm approve-scripts --allow-scripts-pending
```

### API keys

**Both are optional.** Without them Arcadia starts and finds whatever is discoverable locally — 105 of 263 games on the development machine. What they add and where to get them is in [`.env.example`](.env.example).

### Microsoft sign-in

`MICROSOFT_CLIENT_ID` in [`src/main/stores/microsoft/auth.ts`](src/main/stores/microsoft/auth.ts)
is currently the placeholder `00000000-0000-0000-0000-000000000000`. Every
sign-in fails with `invalid_client` until it is replaced with a real
Application (client) ID from a public-client app registration in the [Azure
portal](https://portal.azure.com/): supported account types **"Personal
Microsoft accounts only"**, platform **"Mobile and desktop applications"**,
and **Allow public client flows** enabled. Nothing else changes — the
device-code flow, the polling and the token exchange are already built and
tested against injected HTTP; only that constant is a stand-in.

---

## Usage

```bash
npm run dev        # development, with reload
npm start          # run the built version
npm run dist       # package: installer + portable exe into release/
npm run icon       # redraw build/icon.png (see scripts/make-icon.mjs)
npm test           # 647 unit tests
npm run typecheck  # TypeScript, no output
npm run smoke      # layout test in real Electron — see below
npm run smoke:runtime  # crypto primitives in real Electron — see below
```

The database lives in `%APPDATA%\arcadia` or `~/.config/arcadia`. Deleting it forces a full rebuild.

### Why there is a smoke test

The unit tests cover parsers, adapters, database and filter logic — but none of them ever renders a component. A CSS bug therefore once made **all 193 tiles collapse to 6 pixels tall** without a single test turning red. jsdom would not have found it either: it computes no layout.

`npm run smoke` starts the built interface in real Electron and measures: tile heights, the two-column details page, the screenshot gallery, and whether an image really loads under the CSP.

The same gap exists below the interface, and it bites harder. **Vitest runs on Node, the app runs on Electron, and their crypto is not the same:** Electron links BoringSSL (`process.versions.openssl` reads `0.0.0`), which has no SHA-3 at all. `createHash('sha3-256')` throws *"Digest method not supported"* there while passing every test under Node — which is exactly what happened: 604 green tests next to an EA library that was silently always empty. That is why EA's SHA3-256 is implemented in [`sha3.ts`](src/main/stores/ea/sha3.ts) against published vectors instead of taken from `node:crypto`.

`npm run smoke:runtime` runs those primitives inside real Electron: the NIST vectors, the directory hash a real EA installation uses, and a full encrypt/decrypt round trip through the adapter's own key derivation. It needs no EA installation, no account and no network — the store it decrypts is one it encrypted itself.

---

## What works where

| Store | Windows | Linux |
|---|---|---|
| **Steam** | yes — installed *and* owned | **yes**, four standard paths (`~/.steam/steam`, `~/.local/share/Steam`, Flatpak, Snap) |
| **Epic** | yes — installed *and* owned, from the local catalogue | no, no native client |
| **EA** | yes — installed via the registry, owned from EA's local entitlement store | no, no native client |
| **Ubisoft** | yes — installed via the registry, owned from the launcher's local caches | no, no native client |

On Linux, Epic, EA and Ubisoft cleanly report "no native client" — the app carries on and shows Steam.

> **Unverified:** the Linux branch is covered by tests throughout — the path logic deliberately uses `posix.join` rather than the ambient `join`, so it stays testable on Windows — but **it has never been run on Linux.** That is the largest unverified surface of the project.

---

## Known limits

**Steam shows more games than Arcadia.** `GetOwnedGames` reports only what the account has licensed. Family sharing and free-to-play are missing there. Arcadia therefore also reads Steam's `localconfig.vdf` and marks such games as *Shared/Free*. Measured: 193 → 217, while Steam's own interface shows 226. The remaining nine are unknown to the local file too.

**Ubisoft's library comes from the launcher's caches.** Ubisoft Connect writes both an ownership cache and a configuration catalogue next to each other, so the owned library *and* the real game titles are readable locally — no sign-in and, unlike EA, no network either. Game names now come from that catalogue rather than from the install folder. Both caches reflect the last time Ubisoft Connect signed in, and a game it does not name is left out: measured here, 16 of 17 owned games, against 3 installed.

**EA's owned library is only as fresh as the EA app.** Ownership is read from EA Desktop's own encrypted store on this machine, which is written when the EA app signs in — a purchase made elsewhere appears once EA Desktop has next started. The names come from EA's catalogue service, so that part needs a connection; without one the installed games still appear. Measured on the development machine: 5 games via the registry, 22 owned.

**EA cannot be installed through Arcadia.** The launcher has no deep link for it — checked in the binaries: it knows exactly `game/launch`, `library/open` and `store/open`. Arcadia therefore opens the EA library and says so. Steam, Epic and Ubisoft install for real.

**Some games stay without an image.** Where name matching is uncertain, *no* image is set deliberately: SteamGridDB returns "EA Sports FIFA 21" as the best hit for "EA SPORTS™ FIFA 23", and a wrong image goes unnoticed while a missing one does not. *"Wrong game matched?"* on the details page lets you fix it by hand.

**Images are not downloaded** but loaded straight from the source. Consequence: no images offline, and opening the app produces requests to Valve, Epic and SteamGridDB. The CSP allows exactly those hosts. A scan additionally asks EA's catalogue service for the names of owned EA games; that answer is cached, so it happens once per game rather than once per scan.

**The interface is English, with German fully translated alongside.** All user-visible text lives in [`src/shared/i18n.ts`](src/shared/i18n.ts). English is the default; the German bundle is complete, so adding a language switch means wiring a setting, not writing translations.

---

## Layout

```
src/main/       main process: adapters, database, metadata
  stores/       one adapter per store behind a shared interface
  platform/     VDF parser, registry access
  db/           SQLite schema, migrations, repositories
  metadata/     Steam store, SteamGridDB, queues
src/preload/    the only bridge to the renderer
src/renderer/   React interface
src/shared/     types, IPC contract, strings
```

Three rules, each pinned down by a test:

- **Adapters import no `electron`.** That keeps them testable without Electron; `launch-bridge.ts` is the only place where a URI reaches the shell.
- **Every store identifier is validated before it enters a URI.**
- **`contextIsolation`, `nodeIntegration: false`, `sandbox`** are not negotiable.

The design spec and the implementation plans are kept out of this repository: they record measurements taken against a real installation — account structure, drive layout, library contents. Where a decision needs justifying, the reasoning sits in a comment next to the code instead.

---

## Licence

MIT — see [`LICENSE`](LICENSE). Copyright © 2026 JarJarRen.

The packaged application also ships the licences of the components it
bundles: `LICENSE.electron.txt` and `LICENSES.chromium.html` sit beside the
executable.

## Trademarks

Arcadia is not affiliated with, endorsed by, or sponsored by Valve, Epic
Games, Electronic Arts or Ubisoft. Steam, Epic Games, EA and Ubisoft Connect
are trademarks of their respective owners, used here only to name the stores
Arcadia reads from.

Arcadia reads local files those launchers write, asks their public
catalogue services what a game is called, and opens their own protocol
handlers to start a game. It does not modify them, does not circumvent
anything, and never asks for store credentials.
