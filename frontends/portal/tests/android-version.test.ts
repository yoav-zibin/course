import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
function config(versionCode?: string, variant = 'production') {
  const env: NodeJS.ProcessEnv = {...process.env, NODE_OPTIONS: '', BUILDPLAY_VARIANT: variant};
  delete env.BUILDPLAY_ANDROID_VERSION_CODE;
  if (versionCode !== undefined) env.BUILDPLAY_ANDROID_VERSION_CODE = versionCode;
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    'import config from "./app.config.ts"; console.log(JSON.stringify((config.default || config).android));'],
  {cwd: app, env, encoding: 'utf8'});
}

test('Play builds embed their assigned version and production package', () => {
  const result = config('701');
  assert.equal(result.status, 0, result.stderr);
  const android = JSON.parse(result.stdout);
  assert.equal(android.versionCode, 701);
  assert.equal(android.package, 'fun.buildplay');
});

test('rolling APK keeps its existing debug identifier and default version', () => {
  const result = config(undefined, 'debug');
  assert.equal(result.status, 0, result.stderr);
  const android = JSON.parse(result.stdout);
  assert.equal(android.versionCode, 2);
  assert.equal(android.package, 'fun.buildplay.debug');
});

test('the highest permitted Play version code is accepted', () => {
  const result = config('2100000000');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).versionCode, 2100000000);
});

test('invalid Android version overrides fail before native generation', () => {
  for (const value of ['', '0', '-1', '1.5', '01', 'NaN', ' 7', '2100000001']) {
    const result = config(value);
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /BUILDPLAY_ANDROID_VERSION_CODE must be a positive integer/);
  }
});
