import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {accountDeletion} from '../core/account-deletion';
import {copyText} from '../platform/i18n';
import {Button, Card, Copy, Notice, Title, colors} from './components';
import {useApp} from './context';

export function AccountDeletionStatus({onUndo, testID = 'account-deletion-status'}: {onUndo:()=>Promise<unknown>; testID?:string}) {
  const {p}=useApp(),[now,setNow]=useState(Date.now());
  const status=accountDeletion(p.account,p.profile,now);
  useEffect(()=>{
    if(!status.pending||status.expired||status.started)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.max(1,Math.min(60000,status.deadline-Date.now()+1)));
    return()=>clearTimeout(timer);
  },[status.pending,status.deadline,status.expired,status.started,now]);
  if(!status.pending)return null;
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
    <Card style={{padding:16,borderColor:colors.pink}}>
      <Title small>{copyText('Account deletion scheduled')}</Title>
      <Copy>{status.started?copyText('Account deletion is being processed.'):status.expired?copyText('The undo deadline has passed. Your account is awaiting permanent deletion.'):copyText('Undo before {v0}.',{v0:new Date(status.deadline).toLocaleString(p.locale)})}</Copy>
      {!status.started&&!status.expired&&<Copy small muted>{copyText('You can undo for 24 hours. Permanent deletion may take up to another hour.')}</Copy>}
      {status.canUndo&&<Button secondary disabled={!p.network||p.deletionUpdating} onPress={onUndo}>{copyText('Undo account deletion')}</Button>}
      {!p.network&&status.canUndo&&<Copy small>{copyText('Connect to the internet to update account deletion.')}</Copy>}
    </Card>
  </View>;
}

export function AccountDeletionBanner() {
  const {p}=useApp(),[error,setError]=useState('');
  const scope=JSON.stringify([p.baseUrl,p.account?.id]),current=useRef(scope);current.current=scope;
  useEffect(()=>setError(''),[scope]);
  return <View style={{gap:8}}>
    <AccountDeletionStatus testID="account-deletion-warning" onUndo={async()=>{
      const own=scope;setError('');
      try{await p.actions.cancelAccountDeletion();}
      catch(reason){if(current.current===own)setError(reason instanceof Error?reason.message:String(reason));}
    }}/>
    {error&&<Notice error>{error}</Notice>}
  </View>;
}
