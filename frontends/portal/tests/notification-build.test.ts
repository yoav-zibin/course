import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const app = fileURLToPath(new URL('..', import.meta.url));
function run(raw?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'buildplay-notification-build-'));
  const envFile = path.join(directory, 'github-env');
  const result = spawnSync(process.execPath, ['scripts/configure-notification-build.mjs'], {
    cwd: app, encoding: 'utf8', env: {...process.env, RUNNER_TEMP: directory, GITHUB_ENV: envFile,
      BUILDPLAY_VARIANT: 'debug', BUILDPLAY_ANDROID_GOOGLE_SERVICES_JSON: raw || ''},
  });
  return {directory, envFile, result, cleanup: () => rmSync(directory, {recursive: true, force: true})};
}

test('standalone builds remain possible without Android notification credentials', () => {
  const f = run();
  try {assert.equal(f.result.status, 0); assert.equal(existsSync(f.envFile), false);} finally {f.cleanup();}
});

test('CI prepares matching Firebase client config outside the checkout without printing it', () => {
  const raw = JSON.stringify({project_info: {project_number: '123'}, client: [{client_info: {android_client_info: {package_name: 'fun.buildplay.debug'}}}], private_fixture: 'not-for-logs'});
  const f = run(raw);
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    const filename = path.join(f.directory, 'buildplay-notifications', 'google-services.json');
    assert.equal(readFileSync(filename, 'utf8'), raw);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.equal(readFileSync(f.envFile, 'utf8'), `BUILDPLAY_GOOGLE_SERVICES_FILE=${filename}\n`);
    assert.doesNotMatch(f.result.stdout + f.result.stderr, /not-for-logs/);
  } finally {f.cleanup();}
});

test('a production Firebase client cannot silently configure a debug APK', () => {
  const f = run(JSON.stringify({project_info: {project_number: '123'}, client: [{client_info: {android_client_info: {package_name: 'fun.buildplay'}}}]}));
  try {assert.notEqual(f.result.status, 0); assert.match(f.result.stderr, /must contain a Firebase client/); assert.equal(existsSync(f.envFile), false);} finally {f.cleanup();}
});

test('invalid configuration errors do not echo credential input', () => {
  const f = run('{"sensitive":"not-for-logs"');
  try {assert.notEqual(f.result.status, 0); assert.match(f.result.stderr, /must be valid JSON/); assert.doesNotMatch(f.result.stderr, /not-for-logs/);} finally {f.cleanup();}
});
