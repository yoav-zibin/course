import assert from 'node:assert/strict';
import test from 'node:test';
import {deferredAnalytics} from '../src/platform/analytics-session';

test('sign-out and account switching can overtake first analytics initialization', () => {
  const idle: Array<() => void> = [];
  const views: unknown[] = [];
  const update = deferredAnalytics(task => idle.push(task), (id, screen) => views.push([id, screen]));
  update(null, 'match');
  assert.equal(idle.length, 0);
  update('first', 'games');
  update(null, 'games');
  idle.shift()!();
  assert.deepEqual(views, []);
  update('first', 'games');
  update('second', 'match');
  idle.shift()!();
  update('second', 'match');
  update('second', 'account');
  update(null, 'games');
  update(null, 'local');
  assert.deepEqual(views, [['second', 'match'], ['second', 'account'], [null, 'games']]);
});
