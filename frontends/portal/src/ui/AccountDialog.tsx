import {copyText} from '../platform/i18n';
import React, {useEffect, useState} from 'react';
import {Image, Linking, View} from 'react-native';
import {Button, Card, Choices, Copy, Dialog, Field, Notice, Row, Title, colors} from './components';
import {text,useApp} from './context';
import GoogleLogin from './GoogleLogin';
import {NotificationPreferences} from './Notifications';
import {getLocales} from '../platform/i18n';

export function AccountDialog({visible,onClose}: {visible:boolean;onClose:()=>void}) {
  const {p,run,notify}=useApp(), t=(key:string,fallback:string)=>text(p,key,fallback);
  const [method,setMethod]=useState('guest'),[name,setName]=useState(''),[identifier,setIdentifier]=useState(''),[code,setCode]=useState(''),[verification,setVerification]=useState('');
  const [link,setLink]=useState('link'),[editing,setEditing]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setName(p.account?.display_name||'');setVerification('');setCode('');setError('');},[visible,p.account?.id]);
  const methods=[{value:'guest',label:t('ui.auth.guest','Guest')},...(p.authConfig?.email_login_enabled?[{value:'email',label:t('ui.auth.email','Email')}]:[]),...(p.authConfig?.phone_login_enabled?[{value:'phone',label:t('ui.auth.phone','Phone')}]:[])];
  const act=async(task:()=>Promise<unknown>)=>{setError('');try{await task();}catch(e){setError(e instanceof Error?e.message:String(e));}};
  return <Dialog visible={visible} title={p.account?t('ui.auth.account','Your account'):t('ui.auth.log_in','Welcome to BuildPlay')} onClose={onClose}>
    {error&&<Notice error>{error}</Notice>}
    <Choices label={t('ui.language.label','Language')} value={p.locale} options={getLocales().map(item=>({value:item.code,label:item.native_name||item.name||item.code}))} onChange={value=>act(()=>p.actions.setLocale(value))}/>
    {p.account&&<Card style={{padding:16}}><Row>{p.account.picture_url&&<Image source={{uri:new URL(p.account.picture_url,p.baseUrl).href}} style={{width:52,height:52,borderRadius:26}}/>}<View style={{flex:1,gap:4}}><Title small>{p.account.display_name}</Title><Copy small muted>{p.account.linked?.length?copyText("Verified account"):copyText("Guest account")} · {p.profile?.token_balance??0} {copyText("tokens")}</Copy></View></Row>
      <Row><Button compact secondary onPress={()=>setEditing(!editing)}>{t('ui.auth.edit_name','Edit profile')}</Button><Button compact secondary onPress={()=>act(async()=>{await p.actions.logout();onClose();})}>{t('ui.auth.log_out','Log out')}</Button></Row>
      <Button compact secondary onPress={()=>act(()=>Linking.openURL(new URL('/delete-account',p.baseUrl).href))}>{copyText('Request account deletion')}</Button>
      {editing&&<><Field label={t('ui.auth.display_name','Display name')} value={name} onChangeText={setName} maxLength={200}/><Button disabled={!name.trim()} onPress={()=>act(async()=>{await p.actions.updateProfile({display_name:name.trim()});setEditing(false);})}>{t('ui.action.save','Save')}</Button></>}
    </Card>}
    {p.account&&<>{(p.profile?.referral_code||p.account.referral_code)&&<Copy selectable small>{copyText('Your player code: {v0}',{v0:p.profile?.referral_code||p.account.referral_code})}</Copy>}<NotificationPreferences/></>}
    {p.accounts.length>1&&<View style={{gap:10}}><Copy small muted>{t('ui.auth.switch','Switch account')}</Copy>{p.accounts.filter(a=>a.id!==p.account?.id).map(a=><Button key={a.id} secondary onPress={()=>act(async()=>{await p.actions.switchAccount(a.id);onClose();})}>{a.display_name}</Button>)}</View>}
    {p.account&&<><Title small>{t('ui.auth.add_login','Add a login or use another account')}</Title><Choices label={copyText("Account to use")} value={link} options={[{value:'link',label:copyText("Link to this account")},{value:'new',label:copyText("Use another account")}]} onChange={setLink}/></>}
    {p.authConfig?.google_client_id&&<GoogleLogin clientId={p.authConfig.google_client_id} link={Boolean(p.account&&link==='link')} onToken={token=>act(async()=>{await p.actions.google(token,Boolean(p.account&&link==='link'));onClose();})}/>}
    <Choices label={t('ui.auth.login_method','Continue with')} value={method} options={methods} onChange={value=>{setMethod(value);setVerification('');setCode('');setError('');}}/>
    {method==='guest'?<><Field label={t('ui.auth.display_name','Your name')} value={name} onChangeText={setName} maxLength={200} autoComplete="name"/><Button disabled={!name.trim()||!p.network} onPress={()=>act(async()=>{await p.actions.guest(name.trim());onClose();})}>{t('ui.auth.continue_guest','Continue as guest')}</Button><Copy small muted>{t('ui.auth.guest_warning','Guest accounts are saved on this device. Add a verified login to keep access across devices. Guests receive no welcome tokens.')}</Copy></>
      :<><Field label={method==='phone'?t('ui.auth.phone','Phone number'):t('ui.auth.email','Email')} value={identifier} onChangeText={setIdentifier} keyboardType={method==='phone'?'phone-pad':'email-address'} autoComplete={method==='phone'?'tel':'email'} autoCapitalize="none" editable={!verification}/>
        {!verification?<Row><Button disabled={!identifier.trim()||!p.network} onPress={()=>act(async()=>{const result=await p.actions.requestCode(method as 'email'|'phone',identifier.trim());setVerification(result.verification_id||result.id||identifier.trim());})}>{t('ui.auth.send_code','Send verification code')}</Button>{method==='phone'&&p.authConfig.phone_call_enabled&&<Button secondary disabled={!identifier.trim()} onPress={()=>act(async()=>{const result=await p.actions.requestCode('phone',identifier.trim(),'call');setVerification(result.verification_id||result.id||identifier.trim());})}>{copyText("Call me")}</Button>}</Row>
          :<><Field label={t('ui.auth.code','Verification code')} secureTextEntry value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={12}/><Button disabled={!code.trim()||!p.network} onPress={()=>act(async()=>{await p.actions.verifyCode(method as 'email'|'phone',verification,code.trim(),name.trim()||'Player',Boolean(p.account&&link==='link'));onClose();})}>{t('ui.auth.verify','Verify and continue')}</Button><Button secondary onPress={()=>{setVerification('');setCode('');}}>{copyText("Use another address or resend")}</Button></>}
        <Copy small muted>{t('ui.auth.verified_bonus','Get 1,000 tokens once with your first verified login. Repeat logins do not grant another bonus.')}</Copy>
      </>}
  </Dialog>;
}
