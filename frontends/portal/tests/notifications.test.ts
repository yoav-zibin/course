import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationController, notificationData, type NotificationDriver, type NotificationOptions, type NotificationPermissionState} from '../src/platform/notifications-shared';
import {applicationServerKey, createNotifications, sameApplicationServerKey} from '../src/platform/notifications';

function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};}
function fixture(accountId = 'alice') {
  const calls: string[] = [];
  let permission: NotificationPermissionState = 'granted';
  let endpoint = 'expo:old';
  const driver: NotificationDriver = {
    configKey: 'native_enabled', permission: async () => ({permission}), endpoint: async () => endpoint,
    subscribe: async (_config, prompt) => {calls.push(`subscribe:${prompt}`); if (prompt) permission = 'granted'; return {endpoint, path: '/push/native-subscriptions', body: {token: endpoint.slice(5), platform: 'android'}};},
    unsubscribe: async () => {calls.push('unsubscribe');},
  };
  const options: NotificationOptions = {baseUrl: 'https://buildplay.fun', accountId, request: async (method, path) => {
    calls.push(`${accountId}:${method} ${path}`);
    if (path === '/push/config') return {native_enabled: true};
    if (path === '/push/subscriptions') return [{endpoint}];
    return null;
  }};
  return {calls, driver, options, permission: (value: NotificationPermissionState) => {permission = value;}, endpoint: (value: string) => {endpoint = value;}};
}

test('reconciliation never asks OS permission, while enable is an explicit request', async () => {
  const f = fixture(); f.permission('undetermined');
  const client = createNotificationController(f.options, f.driver);
  assert.deepEqual(await client.reconcile(), {permission: 'undetermined', subscribed: false});
  assert.equal(f.calls.some(call => call.startsWith('subscribe:')), false);
  assert.deepEqual(await client.enable(), {permission: 'granted', subscribed: true});
  assert.ok(f.calls.includes('subscribe:true'));
  await client.disable();
  assert.ok(f.calls.indexOf('alice:DELETE /push/subscriptions?endpoint=expo%3Aold') < f.calls.indexOf('unsubscribe'));
  assert.equal((await client.status()).permission, 'granted');
  client.dispose();
});

test('a permission denial or unavailable delivery service does not register a device', async () => {
  const f = fixture(); f.permission('denied');
  const client = createNotificationController(f.options, f.driver);
  assert.equal((await client.reconcile()).subscribed, false);
  f.permission('granted');
  f.options.request = async () => ({native_enabled: false});
  assert.equal((await client.reconcile()).permission, 'unavailable');
  assert.equal(f.calls.some(call => call.includes('POST')), false);
  client.dispose();
});

test('browser permission starts synchronously in the click before queued HTTP work', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); f.permission('undetermined');
  let permissionCalls = 0, delay = false;
  const requester = f.options.request;
  f.options.request = async (method, path, body) => {
    if (delay && path === '/push/config') {entered.resolve(); await release.promise;}
    return requester(method, path, body);
  };
  f.driver.beginPermissionPrompt = () => {permissionCalls++; f.permission('granted'); return Promise.resolve();};
  const client = createNotificationController(f.options, f.driver);
  await client.reconcile(); assert.equal(permissionCalls, 0);
  delay = true;
  const pendingStatus = client.status(); await entered.promise;
  const enabling = client.enable();
  // This assertion runs in the original call stack, while the queue is blocked.
  assert.equal(permissionCalls, 1);
  release.resolve(); await pendingStatus;
  assert.equal((await enabling).subscribed, true);
  assert.equal(permissionCalls, 1);
  client.dispose();
});

test('disabled server configuration never starts a browser permission prompt', async () => {
  const f = fixture(); f.permission('undetermined');
  f.options.request = async () => ({native_enabled: false});
  let prompts = 0;
  f.driver.beginPermissionPrompt = () => {prompts++; return Promise.resolve();};
  const client = createNotificationController(f.options, f.driver);
  await client.status(); await client.enable(); await client.reconcile();
  assert.equal(prompts, 0);
  client.dispose();
});

test('a late token result after account switch cannot register for the previous account', async () => {
  const old = fixture('alice'), next = fixture('bob'), entered = deferred(), release = deferred();
  old.driver.subscribe = async () => {entered.resolve(); await release.promise; return {endpoint: 'expo:rotated', path: '/push/native-subscriptions', body: {token: 'rotated', platform: 'ios'}};};
  const previous = createNotificationController(old.options, old.driver);
  const enabling = previous.enable(); await entered.promise;
  const deactivate = previous.deactivate(); previous.dispose();
  const current = createNotificationController(next.options, next.driver);
  const reconcile = current.reconcile();
  release.resolve(); await Promise.all([enabling, deactivate, reconcile]);
  assert.equal(old.calls.some(call => call.includes('POST')), false);
  assert.ok(old.calls.some(call => call.includes('DELETE')));
  assert.ok(next.calls.includes('bob:POST /push/native-subscriptions'));
  current.dispose();
});

test('an in-flight old registration is removed before the next account registers', async () => {
  const f = fixture(), entered = deferred(), release = deferred(), calls: string[] = [];
  f.options.request = async (method, path) => {
    calls.push(`alice:${method} ${path}`);
    if (path === '/push/config') return {native_enabled: true};
    if (method === 'POST') {entered.resolve(); await release.promise;}
    return [];
  };
  const previous = createNotificationController(f.options, f.driver), enabling = previous.enable();
  await entered.promise;
  const stopping = previous.deactivate(); previous.dispose();
  const next = fixture('bob'); next.options.request = async (method, path) => {calls.push(`bob:${method} ${path}`); return {native_enabled: true};};
  const current = createNotificationController(next.options, next.driver), starting = current.reconcile();
  release.resolve(); await Promise.all([enabling, stopping, starting]);
  assert.ok(calls.indexOf('alice:DELETE /push/subscriptions?endpoint=expo%3Aold') < calls.indexOf('bob:POST /push/native-subscriptions'));
  current.dispose();
});

test('token rotation drops the old endpoint and retains the new endpoint for disable', async () => {
  const f = fixture(), client = createNotificationController(f.options, f.driver);
  await client.reconcile(); f.endpoint('expo:new'); await client.reconcile(); await client.disable();
  assert.ok(f.calls.includes('alice:DELETE /push/subscriptions?endpoint=expo%3Aold'));
  assert.ok(f.calls.includes('alice:DELETE /push/subscriptions?endpoint=expo%3Anew'));
  client.dispose();
});

test('disposing a same-account UI session retains its persistent device subscription', async () => {
  const f = fixture(), client = createNotificationController(f.options, f.driver);
  await client.reconcile();
  client.dispose();
  assert.equal(f.calls.some(call => call.includes('DELETE')), false);
  assert.equal(f.calls.includes('unsubscribe'), false);
  assert.equal((await client.reconcile()).subscribed, false);
  assert.equal(f.calls.filter(call => call.includes('POST')).length, 1);
});

test('disposing a same-account UI during registration does not delete the accepted endpoint', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.options.request = async (method, path) => {
    f.calls.push(`${method} ${path}`);
    if (path === '/push/config') return {native_enabled: true};
    if (method === 'POST') {entered.resolve(); await release.promise;}
    return [];
  };
  const client = createNotificationController(f.options, f.driver), registration = client.enable();
  await entered.promise; client.dispose(); release.resolve();
  assert.equal((await registration).subscribed, true);
  assert.equal(f.calls.filter(call => call.startsWith('POST')).length, 1);
  assert.equal(f.calls.some(call => call.startsWith('DELETE')), false);
});

test('notification routing accepts account-owned match/invite links and rejects foreign or privileged routes', () => {
  for (const url of ['/portal#match=one', '/static/portal.html#rematch=original', '/i/invite_token']) {
    assert.equal(notificationData({user_id: 'alice', url}, 'https://buildplay.fun', 'alice')?.url, `https://buildplay.fun${url}`);
  }
  for (const url of ['https://other.test/portal', 'javascript:alert(1)', '//other.test/portal', '/admin', 'https://user:password@buildplay.fun/portal']) {
    assert.equal(notificationData({url}, 'https://buildplay.fun', 'alice'), null);
  }
  assert.equal(notificationData({user_id: 'bob', url: '/portal'}, 'https://buildplay.fun', 'alice'), null);
});

test('web VAPID rotation replaces the subscription and removes its old server record', async () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {};
  const calls: string[] = [];
  const key = new Uint8Array([9, 8, 7]), previousKey = new Uint8Array([1, 2, 3]);
  let subscription: any = {endpoint: 'https://push.example/old', options: {applicationServerKey: previousKey.buffer}, unsubscribe: async () => {calls.push('unsubscribe old'); subscription = null;}};
  const registration = {pushManager: {
    getSubscription: async () => subscription,
    subscribe: async (options: any) => {
      assert.deepEqual([...options.applicationServerKey], [...key]);
      subscription = {endpoint: 'https://push.example/new', expirationTime: null, options: {applicationServerKey: key.buffer}, toJSON: () => ({endpoint: 'https://push.example/new', keys: {p256dh: 'key', auth: 'auth'}})};
      return subscription;
    },
  }};
  globals.window = {isSecureContext: true, PushManager: {}, Notification: {}};
  globals.Notification = {permission: 'granted'};
  globals.navigator = {serviceWorker: {getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {}}};
  for (const [key, value] of Object.entries(globals)) {originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {configurable: true, value});}
  try {
    assert.deepEqual([...applicationServerKey('CQgH')], [...key]);
    assert.equal(sameApplicationServerKey(subscription, key), false);
    const client = createNotifications({baseUrl: 'https://buildplay.fun', accountId: 'alice', request: async (method, path) => {
      calls.push(`${method} ${path}`); return {enabled: true, vapid_public_key: 'CQgH'};
    }});
    assert.equal((await client.reconcile()).subscribed, true);
    assert.ok(calls.includes('DELETE /push/subscriptions?endpoint=https%3A%2F%2Fpush.example%2Fold'));
    assert.ok(calls.includes('POST /push/subscriptions'));
    assert.equal(sameApplicationServerKey(subscription, key), true);
    client.dispose();
  } finally {
    for (const [key, descriptor] of originals) {if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);}
  }
});
