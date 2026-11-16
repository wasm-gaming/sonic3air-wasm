// The ROM check runs before anything is downloaded: the likeliest failure, with a
// reason a player can act on. Synthetic ROMs only — no game data in this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRom, isMirrored, ROM_FILE, ROM_SIZE } from '../dist/sonic3air/sonic3air.sdk.js';

const rom = (size, serial) => {
  const bytes = new Uint8Array(size);
  if (serial) bytes.set(new TextEncoder().encode(serial), 0x180);
  return bytes;
};

test('Sonic & Knuckles + Sonic 3: 4 MB, MK-1563', () => {
  assert.deepEqual(checkRom(rom(ROM_SIZE, 'GM MK-1563 -00')), { ok: true });
});

test('no ROM', () => {
  for (const value of [null, undefined, new Uint8Array(0)]) {
    const verdict = checkRom(value);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, new RegExp(ROM_FILE));
  }
});

test('Sonic 3 alone (2 MB) is named as such', () => {
  const verdict = checkRom(rom(ROM_SIZE / 2, 'GM MK-1079 -00'));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /on its own/);
});

test('another 4 MB ROM is told apart by its serial', () => {
  const verdict = checkRom(rom(ROM_SIZE, 'GM MK-1234 -00'));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /MK-1234/);
});

test('a ROM of the wrong size says both sizes', () => {
  const verdict = checkRom(rom(3 * 1024 * 1024, 'GM MK-1563 -00'));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /3145728 bytes/);
});

test('the mirror never copies the host inputs or the log', () => {
  assert.equal(isMirrored(ROM_FILE), false);
  assert.equal(isMirrored('audioremaster.bin'), false);
  assert.equal(isMirrored('logfile.txt'), false);
  assert.equal(isMirrored('settings.json'), true);
  assert.equal(isMirrored('mods/some-mod.zip'), true);
  assert.equal(isMirrored(`mods/${ROM_FILE}`), true);
});
