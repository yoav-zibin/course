import {createNotificationController, type NotificationDriver, type NotificationOptions, type NotificationStatus} from './notifications-shared';
export type {NotificationClient, NotificationData, NotificationOptions, NotificationStatus} from './notifications-shared';

function browserPermission(): Omit<NotificationStatus, 'subscribed'> {
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return {permission: 'unavailable', reason: 'This browser does not support push notifications. On iPhone, add BuildPlay to your Home Screen first.'};
  }
  return {permission: Notification.permission === 'default' ? 'undetermined' : Notification.permission};
}
export function applicationServerKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
}
export function sameApplicationServerKey(subscription: PushSubscription, expected: Uint8Array): boolean {
  const key = subscription.options.applicationServerKey;
  if (!key) return false;
  const actual = new Uint8Array(key);
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function createNotifications(options: NotificationOptions) {
  let knownEndpoint: string | null = null;
  const current = async () => (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription() ?? null;
  const driver: NotificationDriver = {
    configKey: 'enabled',
    permission: async () => browserPermission(),
    beginPermissionPrompt: () => {
      if (browserPermission().permission === 'undetermined') return Notification.requestPermission();
    },
    endpoint: async () => {
      if (knownEndpoint) return knownEndpoint;
      if (browserPermission().permission === 'unavailable') return null;
      return (await current())?.endpoint ?? null;
    },
    subscribe: async config => {
      if (Notification.permission !== 'granted') return null;
      await navigator.serviceWorker.register('/portal-worker.js', {scope: '/', updateViaCache: 'none'});
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const key = applicationServerKey(config.vapid_public_key);
      if (subscription && !sameApplicationServerKey(subscription, key)) {
        // Keep the old endpoint until the controller can remove its server record.
        knownEndpoint = subscription.endpoint;
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ||= await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key as Uint8Array<ArrayBuffer>});
      const json = subscription.toJSON();
      return {endpoint: subscription.endpoint, path: '/push/subscriptions', body: {endpoint: json.endpoint, keys: json.keys, expiration_time: subscription.expirationTime ? new Date(subscription.expirationTime).toISOString() : null}};
    },
    unsubscribe: async () => {
      if (browserPermission().permission !== 'unavailable') await (await current())?.unsubscribe();
      knownEndpoint = null;
    },
    listen: foreground => {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
      const listener = (event: MessageEvent) => {
        if (event.data?.type === 'buildplay-notification') foreground(event.data);
      };
      navigator.serviceWorker.addEventListener('message', listener);
      return () => navigator.serviceWorker.removeEventListener('message', listener);
    },
  };
  return createNotificationController(options, driver);
}
