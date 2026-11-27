import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {test} from 'node:test';

const baselines = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url)));

test('native release archive size grows by at most 50%', () => {
  const {BUILDPLAY_PERF_PLATFORM: platform, BUILDPLAY_PERF_INPUT: input} = process.env;
  assert.ok(platform === 'android' || platform === 'ios', 'Choose android or ios with BUILDPLAY_PERF_PLATFORM');
  assert.ok(input, 'Set BUILDPLAY_PERF_INPUT to the release APK or iOS simulator ZIP');
  assert.ok(input.endsWith(platform === 'android' ? '.apk' : '.zip'), 'Use the platform’s comparable release archive');
  const archive = statSync(input);
  assert.ok(archive.isFile() && archive.size > 0, 'The release archive must be a nonempty file');
  const baseline = baselines.archiveBytes[platform];
  assert.ok(archive.size <= baseline * 1.5,
    `${platform} release is ${archive.size} bytes, versus the ${baseline}-byte baseline (50% allowed)`);
  console.log(`${platform} release: ${archive.size} bytes (baseline ${baseline})`);
});
