// The app's pure part, from the built app (make build-sdk) — which also proves it loads
// next to the SDK with no bundler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, mount } from '../dist/sonic3air/app/app.js';

test('the app is an EngineApp: it exports mount()', () => {
  assert.equal(typeof mount, 'function');
});

test("errors read without the SDK's prefix", () => {
  assert.equal(describeError(new Error('sonic3air: the ROM is 3 bytes')), 'The ROM is 3 bytes');
  assert.equal(describeError('plain'), 'Plain');
  assert.equal(describeError(null), 'Error desconocido');
});
