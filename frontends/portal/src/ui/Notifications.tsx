import React, {useState} from 'react';
import {Pressable, Switch, View} from 'react-native';
import {copyText} from '../platform/i18n';
import type {InAppNotification} from '../core/types';
import {Button, Card, Copy, Dialog, Empty, Notice, Row, Title, colors} from './components';
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
    {!p.notifications.length && <Empty>{copyText('No notifications yet.')}</Empty>}
    {p.notifications.map(item => <NotificationItem key={item.id} item={item} onOpen={onOpen}/>)}
    {p.notificationCursor && <Button secondary onPress={() => run(() => p.actions.refreshNotifications(true))}>{copyText('Load more notifications')}</Button>}
  </Dialog>;
}

export function NotificationItem({item,onOpen}: {item:InAppNotification;onOpen:(notification:InAppNotification)=>Promise<void>}) {
  const [opening,setOpening]=useState(false),[error,setError]=useState('');
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.body}`} accessibilityState={{disabled:opening,busy:opening}} disabled={opening} testID={`notification-${item.id}`}
    onPress={async()=>{if(opening)return;setOpening(true);setError('');try{await onOpen(item);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setOpening(false);}}}
    style={({pressed,focused}:any)=>[opening&&{opacity:.5},pressed&&{opacity:.8},focused&&{outlineColor:colors.blue,outlineStyle:'solid',outlineWidth:2,borderRadius:14}]}>
    <Card style={{padding:16,borderColor:colors.accent}}>
      <Copy style={{fontWeight:'700'}}>{item.title}</Copy><Copy>{item.body}</Copy>{error&&<Notice error>{error}</Notice>}<Copy small muted>{new Date(item.created_at).toLocaleString()}</Copy>
    </Card>
  </Pressable>;
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
