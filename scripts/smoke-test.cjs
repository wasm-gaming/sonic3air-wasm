#!/usr/bin/env node
// Headless boot of the built package with a real ROM (never committed: pass its path).
//
//   ROM=path/to/Sonic_Knuckles_wSonic3.bin [AUDIO=path/to/audioremaster.bin] [SHOTS=dir] make smoke
//
// Serves dist/ (COOP/COEP, like the launcher) and checks, on the SDK demo page:
//   1. it boots with no prompt and no error;
//   2. a standard gamepad (the shape engine-specs' touch pad exposes) drives the menus
//      into a new game, and the save slot the game writes lands in OPFS;
//   3. pause holds the picture, resume moves it again;
//   4. after a reload the save is restored, not lost, and the keyboard drives the menus;
//   5. (AUDIO) the remastered soundtrack is accepted.
// Then the engine app (app.html) on a phone-sized viewport, to a screenshot.
// Needs Chromium + Playwright (preinstalled in the cloud sessions).

const { spawn } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { chromium } = require('playwright');

const ROOT = resolve(__dirname, '..');
const ROM = process.env.ROM && resolve(process.env.ROM);
const AUDIO = process.env.AUDIO && resolve(process.env.AUDIO);
const SHOTS = process.env.SHOTS && resolve(process.env.SHOTS);
const PORT = Number(process.env.PORT ?? 8041);
const BASE = `http://localhost:${PORT}`;
const SAVE = 'sonic3air/smoke/storage/s3air_saveslots.bin';

const fail = (message) => {
  console.error(`smoke: FAIL — ${message}`);
  process.exit(1);
};
if (!ROM || !existsSync(ROM)) fail('set ROM=path/to/Sonic_Knuckles_wSonic3.bin');
if (!existsSync(join(ROOT, 'dist/sonic3air/sonic3air.wasm'))) fail('run `make build` first');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ok = (message) => console.log(`smoke: ok — ${message}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every file in OPFS, path → size. */
const opfs = (page) =>
  page.evaluate(async () => {
    const out = {};
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') out[prefix + name] = (await handle.getFile()).size;
        else await walk(handle, `${prefix}${name}/`);
      }
    };
    await walk(await navigator.storage.getDirectory(), '');
    return out;
  });

const readOpfs = (page, path) =>
  page.evaluate(async (path) => {
    let dir = await navigator.storage.getDirectory();
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const file = await (await dir.getFileHandle(parts.at(-1))).getFile();
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }, path);

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function canvasShot(page) {
  return (await page.locator('#stage canvas').screenshot()).toString('base64');
}

async function boot(page, { gamepad = false } = {}) {
  // Its own storage namespace (?ns=), so it never touches the demo's saves.
  await page.goto(`${BASE}/index.html?ns=smoke`);
  if (gamepad) {
    // A standard gamepad, exposed before the engine starts (SDL enumerates at start-up).
    await page.evaluate(async () => {
      const { exposeAsGamepad } = await import('./sonic3air/engine-specs.js');
      const pad = {
        id: 'smoke pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0], vibrationActuator: null,
      };
      exposeAsGamepad(pad);
      window.smokePad = pad;
    });
  }
  await page.setInputFiles('#rom', ROM);
  if (AUDIO) await page.setInputFiles('#audio', AUDIO);
  await page.click('#start');
  await page.waitForSelector('#stage canvas', { timeout: 30000 });
  await page.waitForFunction(() => /Running|Saved/.test(document.querySelector('#status').textContent), null, { timeout: 120000 })
    .catch(async () => fail(`no boot: ${await page.textContent('#status')}`));
}

async function padPress(page, button, hold = 120) {
  const set = (pressed) =>
    page.evaluate(([b, pressed]) => {
      const pad = window.smokePad;
      pad.buttons[b] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
      pad.timestamp = performance.now();
    }, [button, pressed]);
  await set(true);
  await sleep(hold);
  await set(false);
}

(async () => {
  const server = spawn('python3', [join(ROOT, 'scripts/preview-server.py'), '--port', String(PORT), '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));

    // 1–2: boot, gamepad through the menus into a new game.
    await boot(page, { gamepad: true });
    ok(`boots with no prompt (${(await page.textContent('#status')).trim()})`);
    await sleep(3000);
    // Disclaimer → SEGA → title → main menu → data select → slot 1 (new game).
    for (const button of [9, 9, 9, 0, 0, 0]) {
      await padPress(page, button);
      await sleep(3000);
    }
    await sleep(3000);
    await shot(page, 'smoke-1-gamepad-ingame');
    const files = await opfs(page);
    if (!files[SAVE]) fail(`no save slot in OPFS after a new game with the gamepad: ${JSON.stringify(files)}`);
    ok(`gamepad drove the menus; ${SAVE} (${files[SAVE]} bytes) is in OPFS`);

    // 3: pause holds, resume moves.
    await page.click('#pause');
    await sleep(300);
    const a = await canvasShot(page);
    await sleep(1200);
    const b = await canvasShot(page);
    if (a !== b) fail('the picture changed while paused');
    await page.click('#pause');
    await sleep(1500);
    const c = await canvasShot(page);
    if (b === c) fail('the picture did not move after resume');
    ok('pause holds the picture; resume moves it again');

    // 4: reload — the save comes back (and is not deleted by the mirror); keyboard menus.
    const before = await readOpfs(page, SAVE);
    await page.reload();
    await boot(page);
    await sleep(3000);
    await page.focus('#stage canvas');
    for (const key of ['Enter', 'Enter', 'Enter', 'Enter']) {
      await page.keyboard.press(key);
      await sleep(3000);
    }
    await shot(page, 'smoke-2-keyboard-data-select');
    const after = await readOpfs(page, SAVE).catch(() => null);
    if (!after || after.join() !== before.join()) fail('the save slot was lost or changed across the reload');
    ok('after a reload the save slot is still in OPFS, unchanged; the keyboard drives the menus (see screenshot)');
    if (AUDIO) ok('booted with audioremaster.bin');

    // The engine app, phone-sized, landscape.
    const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const app = await phone.newPage();
    app.on('pageerror', (e) => errors.push(e.message));
    await app.goto(`${BASE}/app.html`);
    await app.setInputFiles('#rom', ROM);
    await app.click('button');
    await app.waitForSelector('.s3air-app[data-screen="game"]', { timeout: 120000 })
      .catch(async () => fail(`the app did not reach the game: ${await app.textContent('.s3air-overlay')}`));
    await sleep(4000);
    await app.touchscreen.tap(422, 200);
    await sleep(500);
    await shot(app, 'smoke-3-app-phone');
    await app.click('.s3air-pause');
    await app.waitForSelector('.s3air-app[data-screen="pause"]');
    await shot(app, 'smoke-4-app-pause');
    ok('the engine app boots on a phone-sized viewport; its pause button opens the pause menu');

    if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
    console.log('smoke: PASS');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((error) => fail(error.stack ?? String(error)));
