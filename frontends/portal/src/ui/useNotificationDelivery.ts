import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {PortalApi} from '../core/api';
import {copyText} from '../platform/i18n';
import {createNotifications} from '../platform/notifications';
import type {Portal} from './context';

type Manager = ReturnType<typeof createNotifications>;
export type DeliveryStatus = Awaited<ReturnType<Manager['status']>>;
export interface NotificationDelivery {
  status: DeliveryStatus | null;
  busy: boolean;
  setEnabled(enabled: boolean): Promise<void>;
  enableDevice(): Promise<void>;
}

/** Each registration owns the credentials and API origin it was created with. */
export function useNotificationDelivery(p: Portal, onOpen: (url: string) => Promise<void>, onError: (message: string) => void, disabled = false): NotificationDelivery {
  const [status, setStatus] = useState<DeliveryStatus | null>(null), [busy, setBusy] = useState(false);
  const current = useRef<Manager | null>(null), latest = useRef(p), open = useRef(onOpen), error = useRef(onError), permission = useRef(status);
  permission.current = status;
  latest.current = p; open.current = onOpen; error.current = onError;
  const enabled = p.profile?.notifications_enabled ?? p.account?.notifications_enabled ?? true;
  useEffect(() => {
    setStatus(null); setBusy(false);
    if (disabled || !p.ready || !p.account || !p.baseUrl) return;
    const account = {...p.account}, base = p.baseUrl;
    const api = new PortalApi(base, () => latest.current.locale);
    let active = true;
    const manager = createNotifications({
      baseUrl: base, accountId: account.id,
      request: (method, path, body) => api.request(method, path, body, account),
      onForeground: () => {if (active) void latest.current.actions.refreshNotifications().catch(() => {});},
      onOpen: payload => {if (active && payload.url) void (async () => {
        await open.current(payload.url!);
        if (!active || latest.current.account?.id !== account.id || latest.current.baseUrl !== base) return;
        if (payload.notification_id) await latest.current.actions.readNotification(payload.notification_id);
        if (active) await latest.current.actions.refreshNotifications();
      })().catch(reason => {if (active) error.current(reason instanceof Error ? reason.message : String(reason));});},
    });
    current.current = manager;
    const refresh = async () => {
      try {
        if ((latest.current.profile?.notifications_enabled ?? latest.current.account?.notifications_enabled) !== false) await manager.reconcile();
        else await manager.disable();
        const result = await manager.status(); if (active) setStatus(result);
      } catch {if (active) setStatus({permission: 'unavailable', subscribed: false});}
    };
    void refresh();
    const resume = AppState.addEventListener('change', value => {if (value === 'active') void refresh();});
    return () => {
      active = false; resume.remove();
      if (current.current === manager) current.current = null;
      // Device enrollment outlives the screen/JS instance. Only moving away from
      // this account or server revokes it; disposal/password refresh keeps it.
      if (latest.current.account?.id !== account.id || latest.current.baseUrl !== base) void manager.deactivate().catch(() => {});
      manager.dispose();
    };
  }, [disabled, p.ready, p.baseUrl, p.account?.id, p.account?.password]);
  useEffect(() => {
    const manager = current.current; if (!manager) return;
    let active = true;
    void (async () => {
      try {
        if (enabled) await manager.reconcile(); else await manager.disable();
        const result = await manager.status(); if (active && current.current === manager) setStatus(result);
      } catch { /* The profile and permission status remain available offline. */ }
    })();
    return () => {active = false;};
  }, [enabled]);
  const setEnabled = useCallback(async (value: boolean) => {
    const manager = current.current, account = latest.current.account, base = latest.current.baseUrl;
    if (!manager || !account) throw new Error('Log in first');
    const stillCurrent = () => current.current === manager && latest.current.account?.id === account.id && latest.current.baseUrl === base;
    setBusy(true);
    try {
      if (value) {
        // A device that cannot enroll can still restore alerts on other devices.
        const supported = permission.current && ['undetermined','granted'].includes(permission.current.permission);
        let result: DeliveryStatus | null = null, enrollmentError: unknown;
        if (supported) try {result = await manager.enable();} catch (error) {enrollmentError = error;}
        if (!stillCurrent()) return;
        if (result) setStatus(result);
        await latest.current.actions.updateProfile({notifications_enabled: true, ...(result && ['granted','denied'].includes(result.permission) ? {notification_prompt_seen:true} : {})});
        if (enrollmentError) throw enrollmentError;
      } else {
        await latest.current.actions.updateProfile({notifications_enabled: false});
        if (!stillCurrent()) return;
        await manager.disable();
      }
      if (stillCurrent()) setStatus(await manager.status());
    } finally {if (stillCurrent()) setBusy(false);}
  }, []);
  const enableDevice = useCallback(async () => {
    const manager = current.current, account = latest.current.account, base = latest.current.baseUrl;
    if (!manager || !account) throw new Error('Log in first');
    const stillCurrent = () => current.current === manager && latest.current.account?.id === account.id && latest.current.baseUrl === base;
    setBusy(true);
    try {
      const result = await manager.enable(); if (!stillCurrent()) return;
      setStatus(result);
      if (['granted','denied'].includes(result.permission)) await latest.current.actions.updateProfile({notification_prompt_seen:true,...(result.subscribed ? {notifications_enabled:true} : {})});
      if (result.permission !== 'granted' || !result.subscribed) throw new Error(copyText(result.reason || (result.permission === 'denied' ? 'Notifications are blocked. Allow them in your browser or device settings.' : 'Push notifications are unavailable on this device.')));
    } finally {if (stillCurrent()) setBusy(false);}
  }, []);
  return {status, busy, setEnabled, enableDevice};
}
