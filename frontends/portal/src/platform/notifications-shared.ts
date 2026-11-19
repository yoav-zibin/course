export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';
export interface NotificationStatus {permission: NotificationPermissionState; subscribed: boolean; reason?: string;}
export interface NotificationData {
  title?: string; body?: string; url?: string; user_id?: string;
  match_id?: string; kind?: string; notification_id?: string;
}
export interface NotificationOptions {
  baseUrl: string;
  accountId: string;
  /** Capture this account's credentials, rather than reading the selected account at request time. */
  request(method: string, path: string, body?: unknown): Promise<any>;
  onForeground?(notification: NotificationData): void;
  onOpen?(notification: NotificationData): void;
}
export interface NotificationClient {
  status(): Promise<NotificationStatus>;
  enable(): Promise<NotificationStatus>;
  disable(): Promise<NotificationStatus>;
  /** Re-register an already permitted device; never requests OS permission. */
  reconcile(): Promise<NotificationStatus>;
  /** Remove this account's server registration while retaining OS permission. */
  deactivate(): Promise<void>;
  dispose(): void;
}
export interface PushRegistration {endpoint: string; path: string; body: unknown;}
export interface NotificationDriver {
  configKey: 'enabled' | 'native_enabled';
  permission(): Promise<Omit<NotificationStatus, 'subscribed'>>;
  endpoint(): Promise<string | null>;
  subscribe(config: any, prompt: boolean): Promise<PushRegistration | null>;
  /** Browser permission must start in the click handler, before awaiting I/O. */
  beginPermissionPrompt?(): Promise<unknown> | void;
  unsubscribe(): Promise<void>;
  listen?(foreground: (data: unknown) => void, open: (data: unknown) => void, refresh: () => void): () => void;
}

/** All account instances share one queue so an old asynchronous registration cannot steal a device back. */
let operations: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = operations.then(run, run); operations = result.catch(() => {}); return result;
}

export function notificationData(value: unknown, baseUrl: string, accountId: string): NotificationData | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.user_id === 'string' && raw.user_id !== accountId) return null;
  const data: NotificationData = {};
  for (const key of ['title', 'body', 'user_id', 'match_id', 'kind', 'notification_id'] as const) {
    if (typeof raw[key] === 'string') data[key] = raw[key].slice(0, key === 'body' ? 2000 : 300);
  }
  if (typeof raw.url === 'string') {
    try {
      const base = new URL(baseUrl), url = new URL(raw.url, base);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return null;
      if (!['/portal', '/static/portal.html'].includes(url.pathname) && !/^\/i\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
      data.url = url.href;
    } catch {return null;}
  } else if (data.match_id) data.url = `${new URL(baseUrl).origin}/portal#match=${encodeURIComponent(data.match_id)}`;
  return data;
}

export function createNotificationController(options: NotificationOptions, driver: NotificationDriver): NotificationClient {
  let active = true, wanted = false, lastEndpoint: string | null = null;
  let configured: boolean | undefined;
  const emit = (kind: 'onForeground' | 'onOpen', value: unknown) => {
    if (!active) return;
    const data = notificationData(value, options.baseUrl, options.accountId);
    if (data) options[kind]?.(data);
  };
  const removeEndpoint = async (endpoint: string | null) => {
    if (endpoint) await options.request('DELETE', `/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`);
  };
  const available = async () => {
    const state = await driver.permission();
    if (state.permission === 'unavailable') {configured = false; return state;}
    const config = await options.request('GET', '/push/config');
    configured = Boolean(config[driver.configKey]);
    if (!configured) return {...state, permission: 'unavailable' as const, reason: 'Push notifications are not enabled on this server.'};
    return state;
  };
  const status = async (): Promise<NotificationStatus> => {
    const state = await available();
    if (state.permission !== 'granted') return {...state, subscribed: false};
    const endpoint = lastEndpoint || await driver.endpoint();
    const subscriptions = endpoint ? await options.request('GET', '/push/subscriptions') : [];
    return {...state, subscribed: Boolean(endpoint && subscriptions.some((item: {endpoint: string}) => item.endpoint === endpoint))};
  };
  const register = (prompt: boolean, permissionPrompt?: Promise<{ok: true} | {ok: false; error: unknown}>) => serial(async (): Promise<NotificationStatus> => {
    if (!active) return {permission: 'unavailable', subscribed: false};
    const state = await available();
    if (state.permission === 'unavailable' || (!prompt && state.permission !== 'granted')) return {...state, subscribed: false};
    if (permissionPrompt) {const result = await permissionPrompt; if (!result.ok) throw result.error;}
    const config = await options.request('GET', '/push/config');
    const registration = await driver.subscribe(config, prompt);
    if (!registration || !active) return {...await driver.permission(), subscribed: false};
    const previous = lastEndpoint || await driver.endpoint();
    if (previous && previous !== registration.endpoint) await removeEndpoint(previous);
    if (!active) return {...await driver.permission(), subscribed: false};
    await options.request('POST', registration.path, registration.body);
    lastEndpoint = registration.endpoint;
    if (!active) {
      await removeEndpoint(lastEndpoint);
      return {...await driver.permission(), subscribed: false};
    }
    wanted = true;
    return {...await driver.permission(), subscribed: true};
  });
  const stopListening = driver.listen?.(value => emit('onForeground', value), value => emit('onOpen', value), () => {
    if (active && wanted) void register(false).catch(() => {});
  });
  return {
    status: () => serial(status),
    enable: () => {
      // Status/reconciliation has already checked server readiness. Start the
      // browser prompt now, while this call still owns the user's click, even if
      // another account operation or an HTTP request is pending in the queue.
      let permissionPrompt: Promise<{ok: true} | {ok: false; error: unknown}> | undefined;
      if (active && configured && driver.beginPermissionPrompt) {
        try {permissionPrompt = Promise.resolve(driver.beginPermissionPrompt()).then(() => ({ok: true as const}), error => ({ok: false as const, error}));}
        catch (error) {return Promise.reject(error);}
      }
      return register(true, permissionPrompt);
    },
    reconcile: () => register(false),
    disable: () => {
      wanted = false;
      return serial(async () => {
        wanted = false;
        await removeEndpoint(lastEndpoint || await driver.endpoint());
        lastEndpoint = null;
        await driver.unsubscribe();
        return {...await driver.permission(), subscribed: false};
      });
    },
    deactivate: () => {
      // Stop registration immediately, including a token request currently in flight.
      active = false; wanted = false;
      return serial(async () => {await removeEndpoint(lastEndpoint || await driver.endpoint()); lastEndpoint = null;});
    },
    dispose: () => {active = false; wanted = false; stopListening?.();},
  };
}
