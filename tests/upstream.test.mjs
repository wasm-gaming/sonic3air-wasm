// The build's two transformations of upstream's files, on synthetic inputs: the data
// package's file list out of loader.js, and the classic script into an ES factory.
// Then, when `make build-upstream` has run, the real artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parsePackageMetadata, wrapModule, UPSTREAM } from '../scripts/fetch-upstream.mjs';

const loader = (files, size) =>
  `var Module = typeof Module != 'undefined' ? Module : {};\n(() => { /* … */\n    }\n    loadPackage(${JSON.stringify({ files, remote_package_size: size, package_uuid: 'sha256-x' })});\n\n  })();\n`;

test('the file list comes out of loader.js', () => {
  const files = [
    { filename: '/sonic3air/config.json', start: 0, end: 10 },
    { filename: '/sonic3air/data/a.bin', start: 10, end: 25 },
  ];
  assert.deepEqual(parsePackageMetadata(loader(files, 25), 25), {
    package: 'sonic3air.data',
    size: 25,
    uuid: 'sha256-x',
    files: [
      { path: '/sonic3air/config.json', start: 0, end: 10 },
      { path: '/sonic3air/data/a.bin', start: 10, end: 25 },
    ],
  });
});

test('a list that does not match the .data fails', () => {
  const files = [{ filename: '/sonic3air/config.json', start: 0, end: 10 }];
  assert.throws(() => parsePackageMetadata(loader(files, 10), 11), /11/);
  assert.throws(() => parsePackageMetadata(loader([{ filename: '/sonic3air/config.json', start: 0, end: 5 }, { filename: '/sonic3air/b', start: 6, end: 10 }], 10), 10), /contiguous/);
  assert.throws(() => parsePackageMetadata(loader([{ filename: '/sonic3air/x', start: 0, end: 10 }], 10), 10), /config\.json/);
  assert.throws(() => parsePackageMetadata('nothing here', 10), /loadPackage/);
});

const classic = [
  'var Module=typeof Module!="undefined"?Module:{};',
  'var noExitRuntime=false;var FS={};var MainLoop={};function callMain(){}var ASM_CONSTS={};',
  'Module["pauseMainLoop"]=1;Module["resumeMainLoop"]=1;',
  'function createWasm(){}function run(){Module.onRuntimeInitialized()}',
  'createWasm();run();',
].join('');

test('the classic script becomes a factory resolving with its own Module', async () => {
  const code = wrapModule(classic);
  assert.match(code, /^\/\/ GENERATED/);
  assert.match(code, new RegExp(UPSTREAM.sha256));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const { default: create } = await import(url);
  const a = await create({ tag: 'a' });
  const b = await create({ tag: 'b' });
  assert.equal(a.tag, 'a');
  assert.equal(b.tag, 'b');
  assert.notEqual(a, b);
  assert.equal(typeof a.callMain, 'function');
  assert.ok(a.FS && a.MainLoop);
  assert.equal(globalThis.Module, undefined, 'nothing leaks onto the global object');
});

test('upstream output that changed shape is refused', () => {
  assert.throws(() => wrapModule('var Module=window.Module;' + classic.slice(48)), /prologue/);
  assert.throws(() => wrapModule(classic.replace('createWasm();run();', 'run();')), /createWasm/);
  assert.throws(() => wrapModule(classic.replace('var noExitRuntime=false;', '')), /noExitRuntime/);
});

const built = new URL('../dist/sonic3air/', import.meta.url);
const haveBuild = existsSync(new URL('sonic3air.js', built));

test('the built engine: data list matches sonic3air.data, the module is a factory', { skip: !haveBuild && 'run make build-upstream' }, async () => {
  const pkg = JSON.parse(readFileSync(new URL('sonic3air.data.json', built), 'utf8'));
  assert.equal(pkg.upstream.tag, UPSTREAM.tag);
  assert.equal(statSync(new URL('sonic3air.data', built)).size, pkg.size);
  assert.ok(pkg.files.some((f) => f.path === '/sonic3air/data/gamedata.bin'));
  assert.ok(statSync(new URL('sonic3air.wasm', built)).size > 1_000_000);
  const source = readFileSync(new URL('sonic3air.js', built), 'utf8');
  assert.match(source, /^export default function createSonic3Air\(moduleArg = \{\}\) \{$/m);
  assert.match(source, /^ {2}noExitRuntime = true;$/m);
});
