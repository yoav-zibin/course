import {visibleErrorMessage} from '../core/account-scope';
import {copyText} from '../platform/i18n';
import React, {useEffect, useRef, useState} from 'react';
import {Image, View} from 'react-native';
import {Button, Card, Choices, Copy, Dialog, Field, Notice, Row, Title, colors} from './components';
import {text,useApp} from './context';
import GoogleLogin from './GoogleLogin';
import {NotificationPreferences} from './Notifications';
import {PrivacyDialog} from './PrivacyDialog';
import {getLocales} from '../platform/i18n';
import {accountDeletion} from '../core/account-deletion';
import {AccountDeletionStatus} from './AccountDeletion';
import {InactiveSignInError} from '../core/api';

export function AccountDialog({visible,onClose}: {visible:boolean;onClose:()=>void}) {
  const {p}=useApp(), t=(key:string,fallback:string)=>text(p,key,fallback);
  const [method,setMethod]=useState('google'),[name,setName]=useState(''),[identifier,setIdentifier]=useState(''),[code,setCode]=useState(''),[verification,setVerification]=useState('');
  const [editing,setEditing]=useState(false),[error,setError]=useState(''),[confirmLink,setConfirmLink]=useState<number|null>(null),[approvedLink,setApprovedLink]=useState<number|null>(null);
  const [confirmDeletion,setConfirmDeletion]=useState(false),[privacy,setPrivacy]=useState(false);
  const scope=JSON.stringify([p.baseUrl,p.account?.id]),current=useRef({scope,visible,epoch:0,dialog:0}),revision=useRef(0);
  if(current.current.scope!==scope||current.current.visible!==visible)current.current={scope,visible,epoch:current.current.epoch+1,dialog:current.current.dialog+(current.current.visible!==visible?1:0)};
  const epoch=current.current.epoch;
  useEffect(()=>{++revision.current;setMethod('google');setName(p.account?.display_name||'');setIdentifier('');setVerification('');setCode('');setError('');setConfirmDeletion(false);setConfirmLink(null);setApprovedLink(null);setPrivacy(false);},[visible,scope]);
  const deletion=accountDeletion(p.account,p.profile);
  const close=()=>{++revision.current;setConfirmDeletion(false);setConfirmLink(null);setApprovedLink(null);setPrivacy(false);onClose();};
  const verifiedMethods=[...(p.authConfig?.google_client_id?[{value:'google',label:'Google'}]:[]),...(p.authConfig?.email_login_enabled?[{value:'email',label:t('ui.auth.email','Email')}]:[]),...(p.authConfig?.phone_login_enabled?[{value:'phone',label:t('ui.auth.phone','Phone')}]:[])];
  const methods=[...verifiedMethods,...(!p.account?[{value:'guest',label:t('ui.auth.guest','Guest')}]:[])];
  const selected=methods.some(item=>item.value===method)?method:methods[0]?.value;
  const allowed=!p.account||approvedLink===epoch;
  const act=async(task:()=>Promise<unknown>)=>{const own=current.current,rev=revision.current;setError('');try{await task();}catch(e){if(current.current===own&&current.current.visible&&revision.current===rev)setError(visibleErrorMessage(e)??'');}};
  const authGuard=()=>{const own=current.current,rev=revision.current;return()=>{if(current.current!==own||!own.visible||revision.current!==rev||p.account&&approvedLink!==own.epoch)throw new InactiveSignInError(copyText('This sign-in request is no longer active. Try again.'));};};
  const authenticate=(task:(guard:()=>void)=>Promise<unknown>)=>{const dialog=current.current.dialog,guard=authGuard();return act(async()=>{guard();await task(guard);if(current.current.visible&&current.current.dialog===dialog)onClose();});};
  return <Dialog visible={visible} title={p.account?t('ui.auth.account','Your account'):t('ui.auth.log_in','Welcome to BuildPlay')} onClose={close}>
    {error&&<Notice error>{error}</Notice>}
    <Choices label={t('ui.language.label','Language')} value={p.locale} options={getLocales().map(item=>({value:item.code,label:item.native_name||item.name||item.code}))} onChange={value=>act(()=>p.actions.setLocale(value))}/>
    {p.account&&<Card style={{padding:16}}><Row>{p.account.picture_url&&<Image source={{uri:new URL(p.account.picture_url,p.baseUrl).href}} style={{width:52,height:52,borderRadius:26}}/>}<View style={{flex:1,gap:4}}><Title small>{p.account.display_name}</Title><Copy small muted>{p.account.linked?.length?copyText("Verified account"):copyText("Guest account")} · {p.profile?.token_balance??0} {copyText("tokens")}</Copy></View></Row>
      <Row><Button compact secondary onPress={()=>setEditing(!editing)}>{t('ui.auth.edit_name','Edit profile')}</Button><Button compact secondary onPress={()=>act(async()=>{await p.actions.logout();onClose();})}>{t('ui.auth.log_out','Log out')}</Button></Row>
      {deletion.pending?<AccountDeletionStatus onUndo={()=>act(()=>p.actions.cancelAccountDeletion())}/>:confirmDeletion?<View testID="account-deletion-confirmation" style={{gap:14}}>
        <Title small>{copyText('Delete this account?')}</Title>
        <Copy>{copyText('Deleting this account is permanent.')}</Copy>
        <Copy>{copyText('Your account, profile and every match you participated in will be removed, including shared and completed matches.')}</Copy>
        <Copy>{copyText('You can undo for 24 hours. Permanent deletion may take up to another hour.')}</Copy>
        {!p.network&&<Copy>{copyText('Connect to the internet to update account deletion.')}</Copy>}
        <Button danger disabled={!p.network||p.deletionUpdating} onPress={()=>act(async()=>{await p.actions.requestAccountDeletion();if(current.current.scope===scope)setConfirmDeletion(false);})}>{copyText('Confirm account deletion')}</Button>
        <Button secondary disabled={p.deletionUpdating} onPress={()=>setConfirmDeletion(false)}>{copyText('Keep my account')}</Button>
      </View>:<Button compact secondary danger disabled={!p.network||p.deletionUpdating} onPress={()=>setConfirmDeletion(true)}>{copyText('Request account deletion')}</Button>}
      {editing&&<><Field label={t('ui.auth.display_name','Display name')} value={name} onChangeText={setName} maxLength={200}/><Button disabled={!name.trim()} onPress={()=>act(async()=>{await p.actions.updateProfile({display_name:name.trim()});setEditing(false);})}>{t('ui.action.save','Save')}</Button></>}
    </Card>}
    {p.account&&<NotificationPreferences/>}
    {!p.account&&p.accounts.length>0&&<View style={{gap:10}}><Copy small muted>{copyText('Saved accounts on this device')}</Copy>{p.accounts.map(a=><Button key={a.id} secondary onPress={()=>authenticate(guard=>p.actions.switchAccount(a.id,guard))}>{copyText('Sign in as {v0}',{v0:a.display_name})}</Button>)}</View>}
    {p.account&&<><Title small>{copyText('Link a verified login')}</Title><Copy small muted>{copyText('To use a different BuildPlay account, log out first.')}</Copy>
      {verifiedMethods.length>0&&!allowed&&<>{confirmLink===epoch?<Card testID="confirm-login-link"><Title small>{copyText('Link this login to your current account?')}</Title><Copy>{copyText('All linked login methods open the same BuildPlay account, with the same profile, matches and tokens.')}</Copy><Row><Button onPress={()=>{if(current.current.epoch===epoch&&current.current.visible){setApprovedLink(epoch);setConfirmLink(null);}}}>{copyText('Confirm link')}</Button><Button secondary onPress={()=>setConfirmLink(null)}>{copyText('Cancel')}</Button></Row></Card>:<Button secondary onPress={()=>setConfirmLink(epoch)}>{copyText('Link a verified login')}</Button>}</>}
      {verifiedMethods.length===0&&<Copy muted>{copyText('Verified login methods are unavailable right now.')}</Copy>}
    </>}
    {(!p.account||!p.account.linked?.length)&&<Copy small muted testID="verified-login-bonus">{t('ui.auth.verified_bonus','Get 10 tokens with your first verified login, then 10 on each later day you visit, up to 100 free tokens total. Days do not need to be consecutive. Guests receive no free tokens.')}</Copy>}
    {allowed&&methods.length>0&&<>
      <Choices label={t('ui.auth.login_method','Continue with')} value={selected} options={methods} onChange={value=>{++revision.current;setMethod(value);setIdentifier('');setVerification('');setCode('');setError('');}}/>
      {selected==='google'?<GoogleLogin clientId={p.authConfig.google_client_id} onToken={token=>authenticate(guard=>p.actions.google(token,Boolean(p.account),guard))} onBrowserLogin={()=>authenticate(guard=>p.actions.browserLogin(Boolean(p.account),guard,true))}/>
      :selected==='guest'?<><Field label={t('ui.auth.display_name','Your name')} value={name} onChangeText={setName} maxLength={200} autoComplete="name"/><Button disabled={!name.trim()||!p.network} onPress={()=>authenticate(guard=>p.actions.guest(name.trim(),guard))}>{t('ui.auth.continue_guest','Continue as guest')}</Button></>
      :<><Field label={selected==='phone'?t('ui.auth.phone','Phone number'):t('ui.auth.email','Email')} value={identifier} onChangeText={setIdentifier} keyboardType={selected==='phone'?'phone-pad':'email-address'} autoComplete={selected==='phone'?'tel':'email'} autoCapitalize="none" editable={!verification}/>
        {!verification?<Row><Button disabled={!identifier.trim()||!p.network} onPress={()=>{const guard=authGuard();return act(async()=>{guard();const result=await p.actions.requestCode(selected as 'email'|'phone',identifier.trim());guard();setVerification(result.verification_id||result.id||identifier.trim());});}}>{t('ui.auth.send_code','Send verification code')}</Button>{selected==='phone'&&p.authConfig.phone_call_enabled&&<Button secondary disabled={!identifier.trim()} onPress={()=>{const guard=authGuard();return act(async()=>{guard();const result=await p.actions.requestCode('phone',identifier.trim(),'call');guard();setVerification(result.verification_id||result.id||identifier.trim());});}}>{copyText('Call me')}</Button>}</Row>
          :<><Field label={t('ui.auth.code','Verification code')} secureTextEntry value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={12}/><Button disabled={!code.trim()||!p.network} onPress={()=>authenticate(guard=>p.actions.verifyCode(selected as 'email'|'phone',verification,code.trim(),name.trim()||'Player',Boolean(p.account),guard))}>{t('ui.auth.verify','Verify and continue')}</Button><Button secondary onPress={()=>{++revision.current;setVerification('');setCode('');}}>{copyText('Use another address or resend')}</Button></>}
      </>}
    </>}
    <Button secondary compact onPress={()=>setPrivacy(true)}>{t('ui.privacy.title','Privacy')}</Button>
    <PrivacyDialog visible={visible&&privacy} onClose={()=>setPrivacy(false)} />
  </Dialog>;
}
