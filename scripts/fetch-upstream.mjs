#!/usr/bin/env node
// The engine half of the package: Sonic 3 A.I.R.'s OFFICIAL web build, pinned and
// checked, made loadable as an ES module. Nothing is compiled and upstream's code is
// never edited — it is downloaded, verified, and scoped.
//
//   node scripts/fetch-upstream.mjs [outDir]     # default: dist/sonic3air
//
// 1. Downloads `sonic3air_web_data.zip` of the pinned release (cached in .tmp/) and
//    fails unless its SHA-256 is the pinned one.
// 2. Copies `sonic3air_web.wasm` and `sonic3air.data` (the engine's own data: config,
//    scripts, audio, fonts — none of the game's ROM) unchanged.
// 3. `loader.js` (Emscripten's file_packager output) → `sonic3air.data.json`: the list
//    of files inside `sonic3air.data`, so the SDK can unpack it without the loader's
//    globals and its IndexedDB cache.
// 4. `sonic3air_web.js` (a classic script with a global `Module`) → `sonic3air.js`:
//    `export default function createSonic3Air(Module)`, upstream's code verbatim inside
//    it — what Emscripten's MODULARIZE + EXPORT_ES6 would have produced. Each call is
//    its own instance; nothing leaks onto `window`.
//
// The anchors it relies on are asserted, so a new upstream release that changes its
// output fails here, loudly, instead of producing a module that half works.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UPSTREAM = Object.freeze({
  repo: 'Eukaryot/sonic3air',
  tag: 'v26.03.28.0-stable',
  asset: 'sonic3air_web_data.zip',
  sha256: '227ceb546388fe37051bb770fcfebcf2128cedc55646b27831f29f8b664b4b3c',
  /** The one folder inside the zip. */
  folder: '20260328_beta',
});

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist/sonic3air'));
const CACHE = join(ROOT, '.tmp/upstream', UPSTREAM.tag);
const ZIP = join(CACHE, UPSTREAM.asset);
const URL_ = `https://github.com/${UPSTREAM.repo}/releases/download/${UPSTREAM.tag}/${UPSTREAM.asset}`;

const die = (message) => {
  throw new Error(`fetch-upstream: ${message}`);
};

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function download() {
  if (existsSync(ZIP) && sha256(ZIP) === UPSTREAM.sha256) {
    console.log(`fetch-upstream: ${UPSTREAM.asset} (${UPSTREAM.tag}) already cached`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log(`fetch-upstream: downloading ${URL_}`);
  const response = await fetch(URL_, { redirect: 'follow' });
  if (!response.ok) die(`${response.status} ${response.statusText} for ${URL_}`);
  writeFileSync(ZIP, new Uint8Array(await response.arrayBuffer()));
  const actual = sha256(ZIP);
  if (actual !== UPSTREAM.sha256) {
    rmSync(ZIP, { force: true });
    die(`SHA-256 mismatch for ${UPSTREAM.asset}: expected ${UPSTREAM.sha256}, got ${actual}`);
  }
  console.log(`fetch-upstream: SHA-256 ok (${UPSTREAM.sha256})`);
}

function extract() {
  const dir = join(CACHE, 'extracted');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const wanted = ['sonic3air_web.js', 'sonic3air_web.wasm', 'sonic3air.data', 'loader.js'].map((name) => `${UPSTREAM.folder}/${name}`);
  execFileSync('unzip', ['-q', '-o', ZIP, ...wanted, '-d', dir], { stdio: 'inherit' });
  return join(dir, UPSTREAM.folder);
}

/** The `loadPackage({...})` argument of file_packager's loader: the files in the .data. */
export function parsePackageMetadata(loaderJs, dataSize) {
  const at = loaderJs.lastIndexOf('loadPackage({');
  if (at < 0) die('loader.js: no loadPackage({...}) call — file_packager output changed');
  const start = at + 'loadPackage('.length;
  const end = loaderJs.indexOf('});', start);
  if (end < 0) die('loader.js: unterminated loadPackage({...})');
  const metadata = JSON.parse(loaderJs.slice(start, end + 1));
  if (metadata.remote_package_size !== dataSize) {
    die(`loader.js says sonic3air.data is ${metadata.remote_package_size} bytes, the file is ${dataSize}`);
  }
  let cursor = 0;
  for (const file of metadata.files) {
    if (typeof file.filename !== 'string' || !file.filename.startsWith('/sonic3air/')) die(`unexpected file ${file.filename}`);
    if (file.start !== cursor || file.end < file.start) die(`${file.filename}: not contiguous (${file.start}-${file.end})`);
    cursor = file.end;
  }
  if (cursor !== dataSize) die(`the files cover ${cursor} of ${dataSize} bytes`);
  if (!metadata.files.some((f) => f.filename === '/sonic3air/config.json')) die('no /sonic3air/config.json in the data package');
  return {
    package: 'sonic3air.data',
    size: dataSize,
    uuid: metadata.package_uuid,
    files: metadata.files.map(({ filename, start, end }) => ({ path: filename, start, end })),
  };
}

/** Upstream's classic script, scoped inside an ES factory. */
export function wrapModule(source) {
  const head = 'var Module=typeof Module!="undefined"?Module:{};';
  if (!source.startsWith(head)) die('sonic3air_web.js no longer starts with the classic `var Module=…` prologue');
  if (!/createWasm\(\);run\(\);\s*$/.test(source)) die('sonic3air_web.js no longer ends with `createWasm();run();`');
  for (const anchor of ['var noExitRuntime=false;', 'var FS={', 'var MainLoop={', 'function callMain(', 'var ASM_CONSTS={', 'Module["pauseMainLoop"]=', 'Module["resumeMainLoop"]=']) {
    if (!source.includes(anchor)) die(`sonic3air_web.js: anchor not found: ${anchor}`);
  }
  if (source.includes('import.meta') || /^\s*(import|export)\s/m.test(source)) die('sonic3air_web.js already looks like a module');

  return `// GENERATED by scripts/fetch-upstream.mjs — do not edit.
//
// Sonic 3 A.I.R. ${UPSTREAM.tag} (https://github.com/${UPSTREAM.repo}/releases/tag/${UPSTREAM.tag}),
// \`${UPSTREAM.folder}/sonic3air_web.js\` from ${UPSTREAM.asset} (SHA-256 ${UPSTREAM.sha256}),
// copied verbatim between the markers below. Copyright Eukaryot and contributors,
// GPL-3.0-or-later (see LICENSE and THIRD_PARTY_NOTICES.md).
//
// Upstream ships a classic script that reads and writes a global \`Module\`. Wrapped in
// a function it is the factory Emscripten's MODULARIZE would have made: each call is
// one instance, and the promise resolves with \`Module\` once the runtime is up, with
// FS, MainLoop and callMain attached to it.
export default function createSonic3Air(moduleArg = {}) {
  var Module = moduleArg;
  var __ready = {};
  var __promise = new Promise((resolve, reject) => {
    __ready.resolve = resolve;
    __ready.reject = reject;
  });
  var __onRuntimeInitialized = Module.onRuntimeInitialized;
  Module.onRuntimeInitialized = () => {
    Module.FS = FS;
    Module.MainLoop = MainLoop;
    Module.callMain = callMain;
    __onRuntimeInitialized?.();
    __ready.resolve(Module);
  };
  var __onAbort = Module.onAbort;
  Module.onAbort = (what) => {
    __onAbort?.(what);
    __ready.reject(new Error('sonic3air: aborted — ' + String(what)));
  };
// ---- upstream sonic3air_web.js ----
${source}
// ---- end of upstream ----
  // Upstream links with EXIT_RUNTIME, so a paused main loop (which its own shell never
  // does) lets the runtime exit on the next frame and the game dies. Emscripten's
  // default instead: the runtime lives as long as the page. The game's own quit still
  // reaches Module.onExit through its own hook.
  noExitRuntime = true;
  return __promise;
}
`;
}

async function main() {
  await download();
  const from = extract();
  mkdirSync(OUT, { recursive: true });

  copyFileSync(join(from, 'sonic3air_web.wasm'), join(OUT, 'sonic3air.wasm'));
  copyFileSync(join(from, 'sonic3air.data'), join(OUT, 'sonic3air.data'));

  const dataSize = statSync(join(from, 'sonic3air.data')).size;
  const metadata = parsePackageMetadata(readFileSync(join(from, 'loader.js'), 'utf8'), dataSize);
  writeFileSync(join(OUT, 'sonic3air.data.json'), `${JSON.stringify({ upstream: UPSTREAM, ...metadata }, null, 2)}\n`);

  writeFileSync(join(OUT, 'sonic3air.js'), wrapModule(readFileSync(join(from, 'sonic3air_web.js'), 'utf8')));

  console.log(`fetch-upstream: ${OUT}/ ← sonic3air.js, sonic3air.wasm, sonic3air.data (+ .json, ${metadata.files.length} files)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
