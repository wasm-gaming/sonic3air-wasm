// The engine owns its folder: every namespace resolves under sonic3air/, and none can
// climb out of it. Runs against the built SDK (make build-sdk), the module a host
// actually imports — which also proves it loads with no import map or bundler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sonic3AirSDK, { storagePath } from '../dist/sonic3air/sonic3air.sdk.js';

const cases = [
  [undefined, 'default', 'sonic3air/default', false],
  ['', 'default', 'sonic3air/default', false],
  [{ id: 'sonic-1' }, 'default', 'sonic3air/default', false],
  ['sonic-1', 'sonic-1', 'sonic3air/sonic-1', false],
  ['sonic-2/profile-a', 'sonic-2/profile-a', 'sonic3air/sonic-2/profile-a', false],
  [' a b /c? ', 'a_b/c_', 'sonic3air/a_b/c_', false],
  ['../x', 'x', 'sonic3air/x', false],
  ['./../../etc', 'etc', 'sonic3air/etc', false],
  ['..', 'default', 'sonic3air/default', false],
  ['/abs/path', 'abs/path', 'sonic3air/abs/path', false],
  // the old convention: the prefix is stripped once, so the files stay where they were
  ['sonic3air/Sonic1', 'Sonic1', 'sonic3air/Sonic1', true],
  // a game literally named like the engine is not mistaken for the prefix
  ['sonic3air', 'sonic3air', 'sonic3air/sonic3air', false],
];

for (const [input, namespace, path, prefixed] of cases) {
  test(`storagePath('sonic3air', ${JSON.stringify(input)}) → ${path}`, () => {
    assert.deepEqual(storagePath('sonic3air', input), { namespace, path, prefixed });
  });
}

test('the engine id is the folder', () => {
  assert.equal(Sonic3AirSDK.id, 'sonic3air');
  assert.ok(storagePath(Sonic3AirSDK.id, 'x').path.startsWith(`${Sonic3AirSDK.id}/`));
});

test('the spec says what a host needs to paint its settings', async () => {
  const { SONIC3AIR_SPEC } = await import('../dist/sonic3air/sonic3air.sdk.js');
  assert.deepEqual(SONIC3AIR_SPEC.assets.rom.allowedTypes, ['.bin', '.md', '.gen']);
  assert.deepEqual(SONIC3AIR_SPEC.assets.audioremaster.allowedTypes, ['.bin']);
  assert.equal(SONIC3AIR_SPEC.storage.namespace.default, 'default');
});
