import React from 'react';
import {Switch, View} from 'react-native';
import {copyText} from '../platform/i18n';
import type {InAppNotification} from '../core/types';
import {Button, Card, Copy, Dialog, Empty, Row, Title, colors} from './components';
import {useApp} from './context';

export function NotificationPreferences() {
  const {p, run, notificationDelivery} = useApp();
  const {status, busy, setEnabled, enableDevice} = notificationDelivery;
  const enabled = (p.profile?.notifications_enabled ?? p.account?.notifications_enabled) !== false;
  return <Card style={{padding:16}}>
    <Row><Title small>{copyText('Push notifications')}</Title><View style={{flex:1}}/><Switch accessibilityLabel={copyText('Push notifications')} value={enabled} disabled={busy || !p.network} trackColor={{true:colors.accent,false:colors.border}} onValueChange={value => {void run(() => setEnabled(value));}}/></Row>
    <Copy small muted>{copyText('Turn alerts, invitations, rematch requests, and match results. In-app notifications remain available when push is off.')}</Copy>
    <Copy small>{!enabled ? copyText('Push notifications are off for your account.') : status?.subscribed && status.permission === 'granted' ? copyText('Enabled on this device') : status?.permission === 'denied' ? copyText('Notifications are blocked. Allow them in your browser or device settings.') : status?.reason ? copyText(status.reason) : status?.permission === 'unavailable' ? copyText('Push notifications are unavailable on this device.') : copyText('Not enabled on this device')}</Copy>
    {enabled && (!status?.subscribed || status.permission !== 'granted') && <Button secondary disabled={busy || !p.network || !status || status.permission === 'unavailable'} onPress={() => run(enableDevice)}>{copyText('Enable on this device')}</Button>}
  </Card>;
}

export function NotificationInbox({visible, onClose, onOpen}: {visible:boolean; onClose:()=>void; onOpen:(notification:InAppNotification)=>Promise<void>}) {
  const {p,run} = useApp();
  return <Dialog visible={visible} title={copyText('Notifications')} onClose={onClose}>
    <Copy small muted>{copyText('Your match updates and requests appear here, even when push notifications are off.')}</Copy>
    <Button compact secondary disabled={!p.network} onPress={() => run(() => p.actions.refreshNotifications())}>{copyText('Refresh')}</Button>
    {!p.notifications.length && <Empty>{copyText('No notifications yet.')}</Empty>}
    {p.notifications.map(item => <Card key={item.id} style={{padding:16,borderColor:item.read_at?colors.border:colors.accent}}>
      <Copy style={{fontWeight:'700'}}>{!item.read_at?'● ':''}{item.title}</Copy><Copy>{item.body}</Copy><Copy small muted>{new Date(item.created_at).toLocaleString()}</Copy>
      <Row><Button compact onPress={() => run(() => onOpen(item))}>{item.event==='rematch_request'?copyText('Join rematch'):item.event==='invite_request'?copyText('View invitation'):copyText('Open')}</Button>{!item.read_at && <Button compact secondary onPress={() => run(() => p.actions.readNotification(item.id))}>{copyText('Mark read')}</Button>}</Row>
    </Card>)}
    {p.notificationCursor && <Button secondary onPress={() => run(() => p.actions.refreshNotifications(true))}>{copyText('Load more notifications')}</Button>}
  </Dialog>;
}

export function NotificationPrompt() {
  const {p, run, notificationDelivery} = useApp();
  return <Dialog visible={p.notificationPrompt && p.notificationPromptReady} title={copyText('Know when it’s your turn')} onClose={p.actions.dismissNotificationPrompt}>
    <Copy>{copyText('Your opponent has the turn. Enable notifications for your next turn, invitations, rematch requests, and match results.')}</Copy>
    <Copy small muted>{copyText('You can change this anytime in your profile.')}</Copy>
    <Button disabled={notificationDelivery.busy || !notificationDelivery.status} onPress={() => run(async () => {p.actions.dismissNotificationPrompt(); await notificationDelivery.enableDevice();})}>{copyText('Enable notifications')}</Button>
    <Button secondary onPress={p.actions.dismissNotificationPrompt}>{copyText('Not now')}</Button>
  </Dialog>;
}
