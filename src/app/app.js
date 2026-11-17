// sonic3air's own app: what a host gets when it mounts this engine instead of driving
// the SDK itself — a boot screen, then the game with its OWN title, save select,
// options and mods, and a pause menu on the wasm-gaming usability scheme
// (engine-specs UX.md).
//
//   import * as app from '<engines>/sonic3air/app/app.js'
//   const handle = await app.mount(target, host)   // EngineApp.mount
//   await handle.unmount()
//
// `host` is engine-specs' EngineAppHost: { game, storage, assets, input, exit }.
// `assets.rom` is required (Sonic_Knuckles_wSonic3.bin), `assets.audioremaster` is
// optional. The input is the host's createInput(): resumed it delivers menu actions;
// suspended (in game) only Select+Start and Escape come through, as `menu`.
//
// No load-game screen and no save states: the game's own save select is the load
// screen, and the engine has no state to snapshot (see RECORD/).
//
// Plain JS and DOM on purpose: the app ships inside the engine's package next to the
// SDK and loads from a static server, so it imports nothing but the SDK and the contract
// runtime shipped beside it (`../engine-specs.js`).

import Sonic3AirSDK from '../sonic3air.sdk.js';
import { createFullscreenToggle, createWakeLock, resolveLocale } from '../engine-specs.js';

const ENGINE = 'sonic3air';
const OWNER = 'app';

/**
 * The app's words, in English and Spanish (engine-specs UX.md, "Languages"). The game's own
 * menus stay as the game ships them.
 */
const STRINGS = {
  booting: { en: 'Starting the engine…', es: 'Arrancando el motor…' },
  bootFailed: { en: 'Could not start', es: 'No se pudo arrancar' },
  back: { en: 'Back', es: 'Volver' },
  paused: { en: 'Paused', es: 'Pausa' },
  choose: { en: 'choose', es: 'elegir' },
  continueHint: { en: 'continue', es: 'continuar' },
  continue: { en: 'Continue', es: 'Continuar' },
  fullscreen: { en: 'Fullscreen', es: 'Pantalla completa' },
  fullscreenHint: { en: 'Alt+Enter · Select + Y', es: 'Alt+Enter · Select + Y' },
  fullscreenHintMac: { en: 'Cmd+Enter · Select + Y', es: 'Cmd+Enter · Select + Y' },
  exit: { en: 'Back to the launcher', es: 'Volver al lanzador' },
  leaveAsk: { en: 'Back to the launcher?', es: '¿Volver al lanzador?' },
  leaveText: { en: 'The game saves where the game itself saves.', es: 'La partida se guarda donde la guarde el juego.' },
  leave: { en: 'Leave', es: 'Salir' },
  stay: { en: 'Stay', es: 'Seguir' },
  unknownError: { en: 'Unknown error', es: 'Error desconocido' },
};

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The error a player reads: the SDK's message without its `sonic3air: ` prefix, capitalised. */
export const describeError = (error, unknown = STRINGS.unknownError.es) => {
  const text = String(error?.message ?? error ?? '').replace(/^sonic3air:\s*/, '');
  return text ? text[0].toUpperCase() + text.slice(1) : unknown;
};

let cssLoaded = null;
const loadCss = () =>
  (cssLoaded ??= new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./app.css', import.meta.url).href;
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  }));

export async function mount(target, host) {
  await loadCss();

  const locale = host.locale ?? resolveLocale();
  const t = (key) => STRINGS[key]?.[locale] ?? STRINGS[key]?.en ?? key;

  const root = document.createElement('div');
  root.className = 's3air-app';
  root.style.setProperty('--accent', host.game?.accent ?? '#2563eb');
  const stage = document.createElement('div');
  stage.className = 's3air-stage';
  const overlay = document.createElement('div');
  overlay.className = 's3air-overlay';
  const pauseButton = document.createElement('button');
  pauseButton.className = 's3air-pause';
  pauseButton.setAttribute('aria-label', t('paused'));
  root.append(stage, overlay, pauseButton);
  target.append(root);

  /** screen: 'boot' | 'game' | 'pause' | 'confirm' | 'error' */
  const state = {
    screen: 'boot',
    status: t('booting'),
    error: null,
    pause: { items: [], focus: 0 },
    confirm: null, // { title, text, yes, no, onYes, onNo, focus, under }
  };

  let play = null;
  let leaving = false;
  let destroyed = false;

  const canvasFocus = () => stage.querySelector('canvas')?.focus({ preventScroll: true });
  const title = () => host.game?.title ?? 'Sonic 3 A.I.R.';

  // ---- screens ------------------------------------------------------------------

  const hints = (pairs) =>
    `<footer class="s3air-hints">${pairs.map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`).join('')}</footer>`;

  // Fullscreen (Cmd+Enter / Alt+Enter, Select + Y, and the pause-menu entry), and the screen
  // kept on while playing. There is no Ajustes screen here: the game's own Options hold the
  // display settings, so the Wake Lock is always on.
  const fullscreen = createFullscreenToggle(root);
  const wake = createWakeLock();

  const render = () => {
    if (destroyed) return;
    wake.setActive(state.screen === 'game');
    root.dataset.screen = state.screen;
    const s = state.screen;
    if (s === 'game') {
      overlay.innerHTML = '';
      return;
    }
    if (s === 'boot') {
      overlay.innerHTML = `<section class="s3air-boot">
        ${host.game?.art ? `<img src="${esc(host.game.art)}" alt="">` : ''}
        <p>${esc(state.status)}</p>
      </section>`;
      return;
    }
    if (s === 'error') {
      overlay.innerHTML = `<section class="s3air-panel">
        <p class="kicker">${esc(title())}</p>
        <h2>${esc(t('bootFailed'))}</h2>
        <p class="text is-error">${esc(state.error)}</p>
        <button class="item is-focused" data-exit>${esc(t('back'))}</button>
      </section>`;
      return;
    }
    let html = '';
    const base = s === 'confirm' ? state.confirm.under : s;
    if (base === 'pause') {
      html += `<section class="s3air-panel">
        <p class="kicker">${esc(title())}</p>
        <h2>${esc(t('paused'))}</h2>
        ${state.pause.items.map((item, i) => `<button class="item${i === state.pause.focus && s !== 'confirm' ? ' is-focused' : ''}" data-item="${i}">${esc(item.label)}${item.hint ? `<small>${esc(item.hint)}</small>` : ''}</button>`).join('')}
        ${hints([['A', t('choose')], ['B', t('continueHint')]])}
      </section>`;
    }
    if (s === 'confirm') {
      const c = state.confirm;
      html += `<div class="s3air-confirm"><section class="s3air-panel">
        <h2>${esc(c.title)}</h2>
        ${c.text ? `<p class="text">${esc(c.text)}</p>` : ''}
        <div class="row">
          <button class="item${c.focus === 0 ? ' is-focused' : ''}" data-confirm="0">${esc(c.no)}</button>
          <button class="item is-danger${c.focus === 1 ? ' is-focused' : ''}" data-confirm="1">${esc(c.yes)}</button>
        </div>
      </section></div>`;
    }
    overlay.innerHTML = html;
  };

  // ---- transitions --------------------------------------------------------------

  const enterGame = () => {
    state.screen = 'game';
    render();
    host.input.suspend();
    canvasFocus();
  };

  const openPause = () => {
    play?.pause(OWNER);
    state.pause = {
      focus: 0,
      items: [
        { label: t('continue'), run: closePause },
        {
          label: t('fullscreen'),
          hint: /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? t('fullscreenHintMac') : t('fullscreenHint'),
          run: () => fullscreen.toggle(),
        },
        { label: t('exit'), run: askExit },
      ],
    };
    state.screen = 'pause';
    host.input.resume();
    render();
  };

  const closePause = () => {
    enterGame();
    play?.resume(OWNER);
  };

  // A confirm sits on top of the screen it was asked from and goes back to it.
  const ask = (options) => {
    state.confirm = { focus: 0, under: state.screen, ...options };
    state.screen = 'confirm';
    render();
  };
  const answer = (yes) => {
    const c = state.confirm;
    state.screen = c.under;
    state.confirm = null;
    render();
    (yes ? c.onYes : c.onNo)?.();
  };

  const exit = async () => {
    if (leaving) return;
    leaving = true;
    try {
      await play?.destroy();
    } catch (error) {
      console.warn(`[${ENGINE} app] destroy failed`, error);
    }
    play = null;
    host.exit();
  };

  const askExit = () =>
    ask({ title: t('leaveAsk'), text: t('leaveText'), yes: t('leave'), no: t('stay'), onYes: exit });

  // ---- input ----------------------------------------------------------------------

  const onPause = (action) => {
    const p = state.pause;
    if (action === 'up') p.focus = (p.focus + p.items.length - 1) % p.items.length;
    else if (action === 'down') p.focus = (p.focus + 1) % p.items.length;
    else if (action === 'accept') return p.items[p.focus].run();
    else if (action === 'back' || action === 'menu') return closePause();
    else return;
    render();
  };

  const onConfirm = (action) => {
    const c = state.confirm;
    if (action === 'left' || action === 'up') c.focus = 0;
    else if (action === 'right' || action === 'down') c.focus = 1;
    else if (action === 'accept') return answer(c.focus === 1);
    else if (action === 'back') return answer(false);
    else return;
    render();
  };

  const off = host.input.on((action) => {
    if (leaving) return;
    const s = state.screen;
    if (s === 'game') {
      if (action === 'menu') openPause();
    } else if (s === 'pause') onPause(action);
    else if (s === 'confirm') onConfirm(action);
    else if (s === 'error' && (action === 'accept' || action === 'back')) exit();
    else if (s === 'boot' && action === 'back') exit();
  });

  // Pointer: hover focuses, click activates — the same paths as the pad. Hover is read
  // from real movement only: every render replaces the buttons, and the browser fires
  // a fresh pointerover for whatever lands under a resting cursor.
  let lastPointer = '';
  const onPointer = (event) => {
    if (event.type === 'pointermove') {
      const at = `${event.clientX},${event.clientY}`;
      if (at === lastPointer) return;
      lastPointer = at;
    }
    const el = event.target.closest('[data-item],[data-confirm],[data-exit]');
    if (!el || leaving) return;
    if (event.type === 'pointermove') {
      if (el.dataset.item != null && state.screen === 'pause' && state.pause.focus !== +el.dataset.item) {
        state.pause.focus = +el.dataset.item;
        render();
      }
      return;
    }
    if (el.dataset.item != null) state.pause.items[+el.dataset.item].run();
    else if (el.dataset.confirm != null) answer(el.dataset.confirm === '1');
    else if (el.dataset.exit != null) exit();
  };
  overlay.addEventListener('click', onPointer);
  overlay.addEventListener('pointermove', onPointer);

  // Touch: the game draws its own on-screen pad; the app adds the pause button, shown
  // once a finger has touched the screen (UX.md), hidden again by a key press.
  const onTouch = (event) => {
    if (event.pointerType === 'touch') root.dataset.touch = '';
  };
  const onKey = () => delete root.dataset.touch;
  root.addEventListener('pointerdown', onTouch, { capture: true });
  window.addEventListener('keydown', onKey, { capture: true });
  pauseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (state.screen === 'game' && !leaving) openPause();
  });

  const handle = {
    async unmount() {
      destroyed = true;
      leaving = true;
      off();
      overlay.removeEventListener('click', onPointer);
      overlay.removeEventListener('pointermove', onPointer);
      root.removeEventListener('pointerdown', onTouch, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      try {
        await play?.destroy();
      } catch {
        /* already gone */
      }
      play = null;
      fullscreen.destroy();
      wake.destroy();
      root.remove();
    },
  };

  // ---- boot -----------------------------------------------------------------------

  render();
  host.input.resume();
  try {
    play = await new Sonic3AirSDK()
      .mount(stage)
      .assets(host.assets)
      .storage(host.storage)
      .on('error', ({ detail }) => console.error(`[${ENGINE} app]`, detail))
      // The game's own quit ends the session (the SDK destroys itself): leave too.
      .on('exit', () => exit())
      .start();
    if (destroyed) {
      // Unmounted while booting: nothing to show any more.
      await play.destroy().catch(() => {});
      play = null;
      return handle;
    }
    enterGame();
  } catch (error) {
    console.error(`[${ENGINE} app]`, error);
    state.error = describeError(error, t('unknownError'));
    state.screen = 'error';
    render();
  }

  return handle;
}
