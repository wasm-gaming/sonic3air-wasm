/**
 * The engine package's entry point: an `EngineSDK` for Sonic 3 A.I.R.
 *
 * ```js
 * import Sonic3AirSDK from '@wasm-gaming/sonic3air-wasm';
 *
 * const play = await new Sonic3AirSDK()
 *   .assets({ rom: () => readRom() })        // Sonic_Knuckles_wSonic3.bin: bytes, or a thunk
 *   .storage({ namespace: 'sonic3air' })     // → OPFS sonic3air/sonic3air/
 *   .mount(document.querySelector('#stage'))
 *   .start();
 *
 * play.pause('menu'); play.resume('menu');
 * await play.destroy();                       // save data flushed, loop stopped, audio closed
 * ```
 *
 * The engine is Eukaryot's **official** WebAssembly build, unchanged (see
 * scripts/fetch-upstream.mjs): `sonic3air.js` is its Emscripten glue scoped in an ES
 * factory, `sonic3air.data` its own data package, unpacked into `/sonic3air/`. The
 * game's menus — title, save select, options, mods — are its own.
 *
 * What the official page did, this does instead:
 * - the ROM comes from `assets.rom` (validated here) — no file prompt;
 * - the save data folder `/sonic3air/savedata` is in memory, seeded from OPFS
 *   `sonic3air/<namespace>/` before the game starts and mirrored back when the game
 *   syncs it, every 10 s, on pause, on page hide and on destroy — no IndexedDB;
 * - the remastered soundtrack is `assets.audioremaster`, never downloaded;
 * - the in-game file manager's hooks (import, export, rename) are provided while a
 *   session runs.
 */
import {
  EnginePlayBase,
  EngineSDKBase,
  EventEmitter,
  type EngineInit,
  type EngineSDKConstructor,
  type EventsOf,
  type PayloadKind,
} from '@wasm-gaming/engine-specs';
import {
  SONIC3AIR_SPEC,
  SONIC3AIR_VIDEO,
  type Sonic3AirAsset,
  type Sonic3AirConfig,
  type Sonic3AirOptions,
  type Sonic3AirPayloads,
} from './sonic3air.options.js';

export type {
  Sonic3AirAsset,
  Sonic3AirAssets,
  Sonic3AirConfig,
  Sonic3AirEvents,
  Sonic3AirOptions,
  Sonic3AirPayloads,
  Sonic3AirStorage,
} from './sonic3air.options.js';
export { SONIC3AIR_SPEC, SONIC3AIR_VIDEO } from './sonic3air.options.js';

const ENGINE_ID = 'sonic3air';
const DEFAULT_STORAGE_NAMESPACE = 'default';
const GAME_ROOT = '/sonic3air';
const SAVEDATA = `${GAME_ROOT}/savedata`;
/** The name and place the engine reads the ROM from (its `RomPath`). */
export const ROM_FILE = 'Sonic_Knuckles_wSonic3.bin';
export const AUDIO_REMASTER_FILE = 'audioremaster.bin';
/** Inputs the host owns, and the engine's log: never mirrored. */
const NOT_SAVES = new Set([ROM_FILE, AUDIO_REMASTER_FILE, 'logfile.txt']);
const SAVE_INTERVAL_MS = 10_000;

/** Sonic & Knuckles with Sonic 3 locked on: 4 MB, serial `MK-1563` in the header. */
export const ROM_SIZE = 4 * 1024 * 1024;
const SERIAL_OFFSET = 0x180;

/** The part of Emscripten's FS this SDK uses. */
interface EmscriptenFS {
  mkdirTree(path: string): void;
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number; mtime: Date | number };
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  rename(from: string, to: string): void;
  unlink(path: string): void;
  chdir(path: string): void;
  syncfs(populate: unknown, callback?: unknown): void;
}

/** What `createSonic3Air` (the generated `sonic3air.js`) resolves with. */
interface Sonic3AirModule {
  FS: EmscriptenFS;
  callMain(args: string[]): void;
  pauseMainLoop(): void;
  resumeMainLoop(): void;
  canvas: HTMLCanvasElement;
  SDL2?: { audioContext?: AudioContext };
  _ImGuiFileBrowser_OnWebImportDone?: () => void;
}

type Sonic3AirFactory = (overrides: Record<string, unknown>) => Promise<Sonic3AirModule>;

/** The files inside `sonic3air.data` (`sonic3air.data.json`, written by the build). */
interface DataPackage {
  size: number;
  files: Array<{ path: string; start: number; end: number }>;
}

/**
 * Where an engine keeps one namespace: `<engineId>/<namespace>`, relative to the OPFS
 * root. Identical in every wasm-gaming engine: segments cleaned, `.` and `..` dropped,
 * anything outside `[A-Za-z0-9._-]` → `_`, nothing usable → `default`; a leading
 * `<engineId>/` is stripped once.
 */
export function storagePath(
  engineId: string,
  namespace: unknown,
): { namespace: string; path: string; prefixed: boolean } {
  const segments =
    typeof namespace === 'string'
      ? namespace
          .split('/')
          .map((segment) => segment.trim())
          .filter((segment) => segment && segment !== '.' && segment !== '..')
          .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_'))
      : [];
  const prefixed = segments.length > 1 && segments[0] === engineId;
  if (prefixed) segments.shift();
  const cleaned = segments.join('/') || DEFAULT_STORAGE_NAMESPACE;
  return { namespace: cleaned, path: `${engineId}/${cleaned}`, prefixed };
}

/**
 * Is this the ROM Sonic 3 A.I.R. needs? The same test as the official page: 4 MB and
 * serial MK-1563 (Sonic & Knuckles, with Sonic 3 locked on) at 0x180. `reason` says
 * what is wrong in words a player can act on.
 */
export function checkRom(bytes: Uint8Array | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: `no ROM — Sonic 3 A.I.R. needs ${ROM_FILE} (Sonic & Knuckles + Sonic 3)` };
  }
  const serial = String.fromCharCode(...bytes.subarray(SERIAL_OFFSET, SERIAL_OFFSET + 14));
  const isLockOn = /MK-1563/.test(serial);
  if (bytes.length === ROM_SIZE && isLockOn) return { ok: true };
  if (bytes.length === ROM_SIZE / 2) {
    return {
      ok: false,
      reason:
        'this is Sonic 3 or Sonic & Knuckles on its own (2 MB); Sonic 3 A.I.R. needs both locked on: ' +
        `"Sonic & Knuckles + Sonic 3" (${ROM_FILE}, 4 MB)`,
    };
  }
  if (bytes.length !== ROM_SIZE) {
    return { ok: false, reason: `the ROM is ${bytes.length} bytes; ${ROM_FILE} has ${ROM_SIZE} (4 MB)` };
  }
  return { ok: false, reason: `not Sonic & Knuckles + Sonic 3 (serial "${serial.trim()}", expected MK-1563)` };
}

async function resolveAsset(asset: Sonic3AirAsset | undefined, name: string): Promise<Uint8Array | null> {
  const value = typeof asset === 'function' ? await asset() : asset;
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`sonic3air: assets.${name} must be a Uint8Array, an ArrayBuffer or a thunk returning one`);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`sonic3air: ${response.status} ${response.statusText} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Write `sonic3air.data`'s files into the FS, as the official loader did. */
function unpackData(FS: EmscriptenFS, data: Uint8Array, pkg: DataPackage): void {
  if (data.length !== pkg.size) throw new Error(`sonic3air: sonic3air.data is ${data.length} bytes, expected ${pkg.size}`);
  for (const file of pkg.files) {
    const dir = file.path.slice(0, file.path.lastIndexOf('/'));
    FS.mkdirTree(dir);
    FS.writeFile(file.path, data.subarray(file.start, file.end));
  }
}

async function opfsDir(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const segment of path.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  } catch {
    return null;
  }
}

type DirEntries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

/** Every file under `dir` (OPFS), as `[relative path, handle]`. */
async function* opfsFiles(dir: FileSystemDirectoryHandle, prefix = ''): AsyncGenerator<[string, FileSystemFileHandle]> {
  for await (const [name, handle] of (dir as unknown as DirEntries).entries()) {
    if (handle.kind === 'file') yield [`${prefix}${name}`, handle as FileSystemFileHandle];
    else yield* opfsFiles(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
  }
}

/** A file's identity for the mirror: changes whenever the game writes it. */
const stamp = (stat: { size: number; mtime: Date | number }): string =>
  `${stat.size}:${stat.mtime instanceof Date ? stat.mtime.getTime() : stat.mtime}`;

/** Is this save-data path (relative to savedata) one the mirror keeps? */
export const isMirrored = (relative: string): boolean => !NOT_SAVES.has(relative);

/** The window hooks the game's file manager calls (its own JS, see RECORD/). */
interface FileManagerWindow {
  __s3airFileUploadPath?: string;
  triggerFileSelect?: () => void;
  fileManagerExportFile?: (path: string) => void;
  fileManagerPromptRename?: (oldName: string, currentPath: string, isFile: number, isCreateDirectory?: number) => void;
}

/** The live engine: one booted Sonic 3 A.I.R. and its session. */
export class Sonic3AirPlay extends EnginePlayBase<Sonic3AirPayloads> {
  #module: Sonic3AirModule | null = null;
  #destroyed = false;
  #pauseOwner: string | null = null;
  #muted = false;

  #canvas: HTMLCanvasElement | null = null;
  #ownsCanvas = false;
  #box: HTMLElement | null = null;
  #boxObserver: ResizeObserver | null = null;
  #onResize = (): void => this.#fit();

  #namespace = DEFAULT_STORAGE_NAMESPACE;
  #storagePath = `${ENGINE_ID}/${DEFAULT_STORAGE_NAMESPACE}`;
  #persist = true;
  #saveTimer: ReturnType<typeof setInterval> | null = null;
  /** Mirrored files (relative to savedata) → the stamp they had when last written to OPFS. */
  #mirrored = new Map<string, string>();
  #flushing: Promise<void> | null = null;
  #flushAgain = false;
  #onHidden = (): void => {
    if (document.visibilityState === 'hidden') void this.flushSaves();
  };
  #onPageHide = (): void => void this.flushSaves();

  #hooks: FileManagerWindow | null = null;
  #fileInput: HTMLInputElement | null = null;

  constructor(init?: EngineInit<Sonic3AirPayloads>, events?: EventEmitter<EventsOf<Sonic3AirPayloads>>) {
    super(SONIC3AIR_SPEC, init, events);
  }

  get namespace(): string {
    return this.#namespace;
  }

  /** Where this session's save data lives, relative to the OPFS root: `sonic3air/<namespace>`. */
  get storagePath(): string {
    return this.#storagePath;
  }

  get pausedBy(): string | null {
    return this.#pauseOwner;
  }

  /**
   * Freeze the game and its sound. The first caller owns the pause; only that owner's
   * {@link resume} lifts it. The save data is flushed.
   */
  pause(owner = 'host'): void {
    const Module = this.#module;
    if (!Module || this.#pauseOwner) return;
    this.#pauseOwner = owner;
    Module.pauseMainLoop();
    void Module.SDL2?.audioContext?.suspend();
    void this.flushSaves();
    this.emit('pause', { owner });
  }

  resume(owner = 'host'): void {
    const Module = this.#module;
    if (!Module || this.#pauseOwner !== owner) return;
    this.#pauseOwner = null;
    if (!this.#muted) void Module.SDL2?.audioContext?.resume();
    Module.resumeMainLoop();
    this.emit('resume', { owner });
  }

  /** Silence the game without stopping it. Independent of {@link pause}. */
  mute(muted = true): void {
    this.#muted = muted;
    const context = this.#module?.SDL2?.audioContext;
    if (muted) void context?.suspend();
    else if (!this.#pauseOwner) void context?.resume();
  }

  get muted(): boolean {
    return this.#muted;
  }

  /** Copy the game's changed save data to OPFS `sonic3air/<namespace>/`; emits `saves`. */
  flushSaves(): Promise<void> {
    if (this.#flushing) {
      // Something changed while a flush was walking the folder: run once more after it.
      this.#flushAgain = true;
      return this.#flushing;
    }
    this.#flushing = (async () => {
      do {
        this.#flushAgain = false;
        await this.#flush();
      } while (this.#flushAgain);
    })().finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  // ---- Contract hooks ----

  protected override mounted(target: HTMLElement): void {
    if (target instanceof HTMLCanvasElement) {
      this.#canvas = target;
      this.#ownsCanvas = false;
      this.#box = target.parentElement;
    } else {
      this.#canvas = document.createElement('canvas');
      this.#ownsCanvas = true;
      this.#box = target;
      target.appendChild(this.#canvas);
    }
    // Emscripten's SDL2 port also finds its window with querySelector('#canvas').
    this.#canvas.id = 'canvas';
    this.#canvas.tabIndex = 0;
    this.#canvas.style.display = 'block';
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    if (this.#ownsCanvas && this.#box) {
      this.#boxObserver?.disconnect();
      this.#boxObserver = new ResizeObserver(() => this.#fit());
      this.#boxObserver.observe(this.#box);
    }
  }

  protected override async open(_options: Sonic3AirOptions): Promise<void> {
    if (this.#destroyed || this.#module) {
      // main() runs once per page and owns the loop.
      throw new Error('sonic3air: the engine cannot be restarted in process — destroy() and start a new page (or iframe)');
    }
    await this.#boot();
  }

  protected override patched(_kind: PayloadKind, _patch: object): void {
    // Nothing in SONIC3AIR_SPEC is live.
  }

  protected override async close(): Promise<void> {
    if (this.#saveTimer) clearInterval(this.#saveTimer);
    this.#saveTimer = null;
    document.removeEventListener('visibilitychange', this.#onHidden);
    window.removeEventListener('pagehide', this.#onPageHide);
    window.removeEventListener('resize', this.#onResize);
    const Module = this.#module;
    if (Module) {
      await this.flushSaves();
      try {
        Module.pauseMainLoop();
      } catch {
        /* already stopped */
      }
      try {
        await Module.SDL2?.audioContext?.close();
      } catch {
        /* already closed */
      }
    }
    this.#removeFileManagerHooks();
    this.#boxObserver?.disconnect();
    this.#boxObserver = null;
    if (this.#ownsCanvas) this.#canvas?.remove();
    this.#canvas = null;
    this.#module = null;
    this.#pauseOwner = null;
    this.#destroyed = true;
  }

  // ---- Boot ----

  async #boot(): Promise<void> {
    const config = await this.#values<Sonic3AirConfig>('config');
    const assets = await this.#values<{ rom?: Sonic3AirAsset; audioremaster?: Sonic3AirAsset }>('assets');
    const storage = await this.#values<{ namespace?: string; persist?: 'opfs' | null }>('storage');
    if (!this.#canvas) throw new Error('sonic3air: mount() an element (or a canvas) before start()');

    // The ROM first: a wrong file is the likeliest failure, and it needs no engine.
    const rom = await resolveAsset(assets.rom, 'rom');
    const verdict = checkRom(rom);
    if (!verdict.ok) throw new Error(`sonic3air: ${verdict.reason}`);

    const resolved = storagePath(ENGINE_ID, storage.namespace);
    if (resolved.prefixed) {
      console.warn(`[sonic3air] storage.namespace no longer needs the "${ENGINE_ID}/" prefix. Pass "${resolved.namespace}".`);
    }
    this.#namespace = resolved.namespace;
    this.#storagePath = resolved.path;
    this.#persist = storage.persist !== null;

    const jsUrl = config.jsUrl ?? new URL('./sonic3air.js', import.meta.url).href;
    const wasmUrl = config.wasmUrl ?? new URL('./sonic3air.wasm', import.meta.url).href;
    const dataUrl = config.dataUrl ?? new URL('./sonic3air.data', import.meta.url).href;

    // The data package downloads while the wasm compiles.
    const data = Promise.all([
      fetchBytes(dataUrl),
      fetch(`${dataUrl}.json`).then((response) => {
        if (!response.ok) throw new Error(`sonic3air: ${response.status} for ${dataUrl}.json`);
        return response.json() as Promise<DataPackage>;
      }),
    ]);
    data.catch(() => {}); // awaited below; never an unhandled rejection meanwhile

    const { default: createSonic3Air } = (await import(/* @vite-ignore */ jsUrl)) as { default: Sonic3AirFactory };
    const Module = await createSonic3Air({
      canvas: this.#canvas,
      noInitialRun: true,
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : new URL(path, jsUrl).href),
      print: (text: string) => console.debug('[sonic3air]', text.trimEnd()),
      printErr: (text: string) => console.warn('[sonic3air]', text.trimEnd()),
      // The game quit by itself (its own "exit"): the session ends like a destroy().
      onExit: () => {
        if (!this.#destroyed) void this.destroy().catch(() => {});
      },
      // A crash once running (one while starting rejects the factory instead).
      onAbort: (what: unknown) => {
        if (this.#module) this.emit('error', new Error(`sonic3air: aborted — ${String(what)}`));
      },
    });
    this.#module = Module;

    const FS = Module.FS;
    const [bytes, pkg] = await data;
    unpackData(FS, bytes, pkg);
    FS.mkdirTree(SAVEDATA);
    FS.mkdirTree(`${GAME_ROOT}/___internal`);

    if (this.#persist) await this.#restoreSaves();
    FS.writeFile(`${SAVEDATA}/${ROM_FILE}`, rom!);
    const remaster = await resolveAsset(assets.audioremaster, 'audioremaster');
    if (remaster) FS.writeFile(`${GAME_ROOT}/data/${AUDIO_REMASTER_FILE}`, remaster);

    // The game calls FS.syncfs(false) right after it writes its save data: that is
    // when the mirror copies it out (the official page synced IndexedDB there).
    const syncfs = FS.syncfs.bind(FS);
    FS.syncfs = (populate: unknown, callback?: unknown) => {
      syncfs(populate, callback);
      if (populate !== true) void this.flushSaves();
    };
    this.#installFileManagerHooks(Module);

    FS.chdir(GAME_ROOT);
    Module.callMain([]);

    if (this.#persist) {
      this.#saveTimer = setInterval(() => void this.flushSaves(), SAVE_INTERVAL_MS);
      document.addEventListener('visibilitychange', this.#onHidden);
      window.addEventListener('pagehide', this.#onPageHide);
    }
    window.addEventListener('resize', this.#onResize);
    this.#fit();
  }

  async #values<T>(kind: 'config' | 'assets' | 'storage'): Promise<T> {
    const described = (await this[kind]()) as Record<string, { value: unknown }>;
    const out: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(described)) out[key] = property.value;
    return out as T;
  }

  // ---- Save data mirror ----

  /** Every file under savedata the mirror keeps, relative path → stamp. */
  #walk(): Map<string, string> {
    const FS = this.#module!.FS;
    const found = new Map<string, string>();
    const visit = (dir: string, prefix: string): void => {
      let names: string[];
      try {
        names = FS.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (name === '.' || name === '..') continue;
        const path = `${dir}/${name}`;
        const stat = FS.stat(path);
        if (FS.isDir(stat.mode)) visit(path, `${prefix}${name}/`);
        else if (FS.isFile(stat.mode) && isMirrored(`${prefix}${name}`)) found.set(`${prefix}${name}`, stamp(stat));
      }
    };
    visit(SAVEDATA, '');
    return found;
  }

  async #restoreSaves(): Promise<void> {
    const dir = await opfsDir(this.#storagePath, false);
    const Module = this.#module;
    if (!dir || !Module) return;
    for await (const [relative, handle] of opfsFiles(dir)) {
      if (!isMirrored(relative)) continue;
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const path = `${SAVEDATA}/${relative}`;
      Module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      Module.FS.writeFile(path, bytes);
      this.#mirrored.set(relative, stamp(Module.FS.stat(path)));
    }
  }

  async #flush(): Promise<void> {
    const Module = this.#module;
    if (!Module || !this.#persist) return;
    const now = this.#walk();
    const changed = [...now].filter(([relative, current]) => this.#mirrored.get(relative) !== current);
    const removed = [...this.#mirrored.keys()].filter((relative) => !now.has(relative));
    if (changed.length === 0 && removed.length === 0) return;

    const root = await opfsDir(this.#storagePath, true);
    if (!root) return;
    const folder = async (relative: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
      let dir = root;
      for (const segment of relative.split('/').slice(0, -1)) {
        try {
          dir = await dir.getDirectoryHandle(segment, { create });
        } catch {
          return null;
        }
      }
      return dir;
    };

    const written: string[] = [];
    for (const [relative, current] of changed) {
      try {
        const bytes = Module.FS.readFile(`${SAVEDATA}/${relative}`);
        const dir = await folder(relative, true);
        if (!dir) continue;
        const writable = await (await dir.getFileHandle(relative.split('/').pop()!, { create: true })).createWritable();
        await writable.write(new Uint8Array(bytes));
        await writable.close();
        this.#mirrored.set(relative, current);
        written.push(relative);
      } catch (error) {
        console.warn(`[sonic3air] could not persist ${relative}`, error);
      }
    }
    const gone: string[] = [];
    for (const relative of removed) {
      try {
        const dir = await folder(relative, false);
        await dir?.removeEntry(relative.split('/').pop()!);
      } catch {
        /* already gone */
      }
      this.#mirrored.delete(relative);
      gone.push(relative);
    }
    if (written.length || gone.length) this.emit('saves', { files: written, removed: gone });
  }

  // ---- The game's file manager (Options → its own file browser) ----

  #installFileManagerHooks(Module: Sonic3AirModule): void {
    const win = window as unknown as FileManagerWindow;
    const done = (): void => {
      try {
        Module._ImGuiFileBrowser_OnWebImportDone?.();
      } catch {
        /* the browser was closed meanwhile */
      }
      void this.flushSaves();
    };

    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      let folder = win.__s3airFileUploadPath || `${SAVEDATA}/`;
      if (!folder.endsWith('/')) folder += '/';
      try {
        Module.FS.writeFile(`${folder}${file.name}`, new Uint8Array(await file.arrayBuffer()));
      } catch (error) {
        console.warn('[sonic3air] import failed', error);
      }
      done();
    });
    document.body.append(input);
    this.#fileInput = input;

    this.#hooks = {
      // Called from the game's frame, right after the key or click that chose "import":
      // still within the browser's user activation, so the picker may open.
      triggerFileSelect: () => input.click(),
      fileManagerExportFile: (path: string) => {
        try {
          const bytes = new Uint8Array(Module.FS.readFile(path));
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = path.split('/').filter(Boolean).pop() ?? 'download.bin';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (error) {
          console.warn('[sonic3air] export failed', error);
        }
      },
      fileManagerPromptRename: (oldName, currentPath, isFile, isCreateDirectory) => {
        // Deferred: prompt() blocks, and this is called from inside a frame.
        setTimeout(() => {
          const creating = !!isCreateDirectory;
          const value = window.prompt(creating ? 'Create folder:' : isFile ? 'Rename file:' : 'Rename folder:', oldName || '');
          const name = value?.trim();
          if (!name || (!creating && name === oldName) || /[\\/*?:|<>"]/.test(name)) return;
          try {
            if (creating) Module.FS.mkdir(`${currentPath}${name}`);
            else Module.FS.rename(`${currentPath}${oldName}`, `${currentPath}${name}`);
          } catch (error) {
            console.warn('[sonic3air] rename failed', error);
          }
          done();
        }, 0);
      },
    };
    Object.assign(win, this.#hooks);
  }

  #removeFileManagerHooks(): void {
    const win = window as unknown as Record<string, unknown>;
    for (const [name, hook] of Object.entries(this.#hooks ?? {})) {
      if (win[name] === hook) delete win[name];
    }
    delete win.__s3airFileUploadPath;
    this.#hooks = null;
    this.#fileInput?.remove();
    this.#fileInput = null;
  }

  // ---- Picture ----

  /** The engine draws 16:9 at the window's width; show it whole, centred, in the box. */
  #fit(): void {
    const canvas = this.#canvas;
    const box = this.#box;
    if (!canvas || !box || !this.#ownsCanvas) return;
    const { width, height } = box.getBoundingClientRect();
    if (!width || !height) return;
    const w = Math.min(width, height * SONIC3AIR_VIDEO.ratio);
    canvas.style.width = `${Math.floor(w)}px`;
    canvas.style.height = `${Math.floor(w / SONIC3AIR_VIDEO.ratio)}px`;
  }
}

/** The factory a host constructs: static identity, the configuration chain, `start()`. */
export class Sonic3AirSDK extends EngineSDKBase<Sonic3AirPayloads> {
  static readonly id = ENGINE_ID;
  /** Kept in step with package.json by `node scripts/sync-version.mjs`. */
  static readonly version = '0.0.0';
  static readonly name = 'Sonic 3 A.I.R.';
  static readonly description =
    "Sonic 3 - Angel Island Revisited, Eukaryot's official WebAssembly build. Ships none of the game: the player provides the Sonic & Knuckles + Sonic 3 ROM, and it never leaves their browser.";

  protected override createPlay(
    init: EngineInit<Sonic3AirPayloads>,
    events: EventEmitter<EventsOf<Sonic3AirPayloads>>,
  ): Sonic3AirPlay {
    return new Sonic3AirPlay(init, events);
  }
}

/** CI's conformance line: if this class stops satisfying the contract, `make test` fails. */
export const SONIC3AIR_ENGINE: EngineSDKConstructor<Sonic3AirPayloads> = Sonic3AirSDK;

export default Sonic3AirSDK;
