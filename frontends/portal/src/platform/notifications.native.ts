import Constants from 'expo-constants';
import {isDevice} from 'expo-device';
import * as Notifications from 'expo-notifications';
import {Platform} from 'react-native';
import * as storage from './storage';
import {copyText} from './i18n';
import {createNotificationController, type NotificationDriver, type NotificationOptions, type NotificationStatus} from './notifications-shared';
export type {NotificationClient, NotificationData, NotificationOptions, NotificationStatus} from './notifications-shared';

// The active app renders its own alert and inbox. Background presentation remains
// the platform's normal remote-notification behavior.
Notifications.setNotificationHandler({handleNotification: async () => ({
  shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
})});
const CHANNEL = 'matches';

export function createNotifications(options: NotificationOptions) {
  const extra = Constants.expoConfig?.extra;
  const projectId = extra?.eas?.projectId || Constants.easConfig?.projectId;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const cacheKey = `buildplay.push-token.v1:${new URL(options.baseUrl).origin}:${projectId || 'unconfigured'}:${platform}`;
  let oldEndpoint: string | null = null, deviceToken: Notifications.DevicePushToken | undefined;
  const permission = async (): Promise<Omit<NotificationStatus, 'subscribed'>> => {
    if (!isDevice) return {permission: 'unavailable', reason: 'Push notifications require a physical device.'};
    if (!projectId || !extra?.nativePushConfigured?.[platform]) return {permission: 'unavailable', reason: 'Push notifications are not configured in this app build.'};
    const result = await Notifications.getPermissionsAsync();
    const allowed = result.granted || result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    return {permission: allowed ? 'granted' : result.status === 'denied' ? 'denied' : 'undetermined'};
  };
  const driver: NotificationDriver = {
    configKey: 'native_enabled', permission,
    endpoint: async () => oldEndpoint || await storage.getItem(cacheKey),
    subscribe: async (_config, prompt) => {
      if ((await permission()).permission === 'unavailable') return null;
      // Android 13 must have a channel before asking permission or obtaining a token.
      if (platform === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: copyText('Match updates'), importance: Notifications.AndroidImportance.DEFAULT,
      });
      if (prompt && (await permission()).permission !== 'granted') await Notifications.requestPermissionsAsync({
        ios: {allowAlert: true, allowBadge: true, allowSound: true},
      });
      if ((await permission()).permission !== 'granted') return null;
      oldEndpoint = await storage.getItem(cacheKey);
      // A refresh listener supplies the native token; asking for it again there
      // would recursively trigger another refresh event.
      const token = (await Notifications.getExpoPushTokenAsync({projectId, ...(deviceToken ? {devicePushToken: deviceToken} : {})})).data;
      const endpoint = `expo:${token}`;
      await storage.setItem(cacheKey, endpoint);
      return {endpoint, path: '/push/native-subscriptions', body: {token, platform}};
    },
    unsubscribe: async () => {
      // Keep the native token cached: it is a device address, not consent. Removing
      // the backend record stops this account without invalidating OS permission.
      oldEndpoint = null;
    },
    listen: (foreground, open, refresh) => {
      if (!isDevice || !projectId || !extra?.nativePushConfigured?.[platform]) return () => {};
      const data = (notification: Notifications.Notification) => ({
        ...notification.request.content.data,
        title: notification.request.content.title ?? undefined,
        body: notification.request.content.body ?? undefined,
      });
      let stopped = false;
      const handled = new Set<string>();
      const receiveResponse = (response: Notifications.NotificationResponse) => {
        if (stopped || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        const id = response.notification.request.identifier;
        if (handled.has(id)) return;
        handled.add(id); open(data(response.notification));
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      };
      const subscriptions = [
        Notifications.addNotificationReceivedListener(notification => foreground(data(notification))),
        Notifications.addNotificationResponseReceivedListener(receiveResponse),
        Notifications.addPushTokenListener(token => {deviceToken = token; refresh();}),
      ];
      void Notifications.getLastNotificationResponseAsync().then(response => {if (response) receiveResponse(response);}).catch(() => {});
      return () => {stopped = true; for (const subscription of subscriptions) subscription.remove();};
    },
  };
  return createNotificationController(options, driver);
}
