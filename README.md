# sonic3air-wasm

**Sonic 3 A.I.R.** (Angel Island Revisited, by [Eukaryot](https://github.com/Eukaryot/sonic3air)) as a
wasm-gaming engine package: the project's **official WebAssembly build**, pinned and checked, behind a
self-contained JS SDK that implements the [engine contract](https://github.com/wasm-gaming/engine-specs),
plus the engine's own app (boot screen + pause menu) for launchers.

Ships none of SEGA's game: the player provides the **Sonic & Knuckles + Sonic 3** ROM
(`Sonic_Knuckles_wSonic3.bin`, 4 MB — the Steam release's file, or a Mega Drive dump of the lock-on),
and it never leaves their browser.

```js
import Sonic3AirSDK from '@wasm-gaming/sonic3air-wasm';

const play = await new Sonic3AirSDK()
  .assets({ rom: () => readRom() })            // bytes, or a thunk; audioremaster optional
  .storage({ namespace: 'sonic3air' })         // → OPFS sonic3air/sonic3air/
  .on('saves', ({ detail }) => console.log('saved', detail.files))
  .mount(document.querySelector('#stage'))
  .start();

play.pause('menu');
play.resume('menu');
await play.destroy();                          // save data flushed, loop stopped, audio closed
```

Or mount the app, as play.germade does (`EngineApp` from engine-specs):

```js
import * as app from '@wasm-gaming/sonic3air-wasm/app';
const handle = await app.mount(target, { game, storage: { namespace }, assets: { rom }, input, exit });
```

## Project Specs

- **Engine**: `Eukaryot/sonic3air` release **`v26.03.28.0-stable`**, asset `sonic3air_web_data.zip`
  (SHA-256 `227ceb54…4b3c`). Nothing is compiled here. `make build-upstream`
  (`scripts/fetch-upstream.mjs`) downloads it, checks the hash, and writes to `dist/sonic3air/`:
  - `sonic3air.wasm`, `sonic3air.data`: copied unchanged.
  - `sonic3air.data.json`: the file list inside `sonic3air.data`, read from upstream's `loader.js`.
  - `sonic3air.js`: upstream's classic Emscripten script inside
    `export default function createSonic3Air(Module)`. That is the factory `MODULARIZE` would have
    made: one instance per call, and nothing on `window`.

  The script checks every anchor it relies on, so a changed upstream output fails the build.
- **One deliberate change to the runtime's behaviour**: the factory sets `noExitRuntime = true`.
  Upstream links with `EXIT_RUNTIME`, so pausing the main loop (which its own page never does) made
  the runtime exit and the game die.
- **SDK** (`Sonic3AirSDK` / `Sonic3AirPlay`, engine-specs `^0.5.1`, its runtime copied beside the SDK):
  - **ROM**: `assets.rom` is validated before anything downloads (4 MB, serial MK-1563 at 0x180), with
    reasons a player can act on (e.g. "Sonic 3 on its own"). It is written to
    `/sonic3air/savedata/Sonic_Knuckles_wSonic3.bin`, so no prompt ever appears.
  - **Remastered soundtrack**: `assets.audioremaster` (optional, `audioremaster.bin`) is written to
    `/sonic3air/data/`. The SDK never downloads it.
  - **Save data** (`settings.json`, `settings_input.json`, `storage/s3air_saveslots.bin`, mods…):
    `/sonic3air/savedata` lives in memory. It is restored from OPFS `sonic3air/<namespace>/` before the
    game starts and mirrored back:
    - when the game syncs (its own `FS.syncfs(false)` after a save);
    - every 10 s, on pause, on page hide and on destroy.

    Files the game deletes are deleted in OPFS too. The ROM, `audioremaster.bin` and `logfile.txt` are
    never mirrored. Each mirror emits a `saves` event (`{ files, removed }`).
  - **Pause**: `pause(owner)` / `resume(owner)` stop and restart Emscripten's main loop and the SDL
    `AudioContext`. One owner at a time.
  - **Game exit**: the game's own quit ends the session (`exit`).
  - **File manager**: the in-game one (Options) works. The SDK provides its import, export and rename
    hooks while a session runs.
  - **Canvas**: the engine draws 16:9 at the window's width. The SDK shows it whole, centred, in the
    mounted box.
  - **Restarts**: one `main()` per page; `restart()` throws.
- **Input**: the game's own SDL2 input. Keyboard: arrows, A / S / D (+ Q / W), Enter = Start,
  Esc / Backspace = Back, E / R = L / R. Gamepads come through `navigator.getGamepads()`, including the
  engine-specs touch pad. On touch screens the game also draws its own pad.
- **Network**: upstream's online features (update check, ghost sync with sonic3air.org) are off by
  default and only start if the player turns them on in the game's options. No requests were seen at
  boot or in play.
- **App** (`app/app.js`):
  - A boot screen, then the game's own title, save select, options and mods.
  - The pause menu (UX.md) opens with Escape or Select + Start, or on touch with a ❚❚ button.
    It offers **Continuar** and **Volver al lanzador** (with a confirm).
  - Errors (e.g. the wrong ROM) appear on a screen with a way back.
  - No save states: the engine has none to expose.
- **No SharedArrayBuffer**: the build is single-threaded. It runs on any static server, and also under
  the launcher's COOP/COEP.

## Build

```bash
npm install
make build            # upstream (download + check + wrap) + SDK + app + demo → dist/
make test             # type-check + node --test (synthetic ROMs only)
make smoke ROM=path/to/Sonic_Knuckles_wSonic3.bin [AUDIO=path/to/audioremaster.bin] [SHOTS=dir]
make preview          # dist/ on :8040 — index.html (SDK), app.html (the engine app)
```

`make smoke` runs headless Chromium against the build:
- boot with no prompt;
- a standard gamepad drives the menus into a new game, and the save slot lands in OPFS;
- pause holds the picture and resume moves it again;
- after a reload the save is still there and the keyboard drives the menus;
- the app on a phone-sized viewport, including its pause button.

Releases (`.github/workflows/release.yml`) publish to npm. They also attach `sonic3air.tar.gz` / `.zip`
to the GitHub Release, which the launcher fetches (`sonic3air/sonic3air/…`).

## Todos

- [ ] Phase 2 only if needed: build from source (pinned commit, emsdk 4.0.23) for hooks the official
      binary lacks.
- [ ] A load-game screen in the app, if the save slot format (`storage/s3air_saveslots.bin`) proves
      stable enough to read.
- [ ] The file manager's import needs the browser's user activation: from a gamepad alone it may not
      open the picker.

## License

**GPL-3.0-or-later** for the whole repository; see [LICENSE](LICENSE). The binary and the data are
Sonic 3 A.I.R. (GPL-3.0). The SDK and the app exist to run them, so they are released under the same
licence. The corresponding source is upstream's tree at the pinned tag. The binary also contains
SDL2 (zlib) and Dear ImGui (MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Both files
are copied into `dist/sonic3air/`, so every release archive and the npm package carry them.

Sonic 3 A.I.R. is a non-profit fan project, not affiliated with SEGA or Sonic Team. Sonic the
Hedgehog is a trademark of SEGA.
