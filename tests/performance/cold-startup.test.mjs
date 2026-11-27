import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const baselines = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url)));

test('mean cold time to first draw grows by at most 50%', () => {
  const {BUILDPLAY_PERF_PLATFORM: platform, BUILDPLAY_PERF_INPUT: input} = process.env;
  assert.ok(Object.hasOwn(baselines.firstDrawMs, platform), 'Choose android, ios or web with BUILDPLAY_PERF_PLATFORM');
  assert.ok(input, 'Set BUILDPLAY_PERF_INPUT to the benchmark output JSON');
  const runs = JSON.parse(readFileSync(input));
  assert.ok(Array.isArray(runs) && runs.length >= 3, 'Measure at least three independent cold launches');
  const samples = platform === 'ios' ? runs.map(run => run?.home_ms) : runs;
  assert.ok(samples.every(ms => Number.isFinite(ms) && ms > 0), 'Each measured first-draw time must be positive and finite');
  const mean = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  const baseline = baselines.firstDrawMs[platform];
  assert.ok(mean <= baseline * 1.5,
    `${platform} averaged ${mean.toFixed(1)} ms, versus the ${baseline} ms baseline (50% allowed)`);
  console.log(`${platform} first draw: ${mean.toFixed(1)} ms across ${samples.length} launches (baseline ${baseline} ms)`);
});
