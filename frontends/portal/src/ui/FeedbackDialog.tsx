import {copyText} from '../platform/i18n';
import React,{useState} from 'react';
import {Button,Choices,Copy,Dialog,Field,Notice} from './components';
import {text,useApp} from './context';
export function FeedbackDialog({visible,onClose,target}: {visible:boolean;onClose:()=>void;target:{type:'platform'|'game'|'match'|'user';id?:string;name?:string}}) {
  const {p,openAccount}=useApp(),t=(key:string,fallback:string)=>text(p,key,fallback);
  const [kind,setKind]=useState('bug'),[value,setValue]=useState(''),[error,setError]=useState(''),[sent,setSent]=useState(false);
  return <Dialog visible={visible} title={t('ui.feedback.general','Feedback')} onClose={()=>{setSent(false);setError('');onClose();}}>
    {sent?<><Notice>{t('ui.feedback.thanks','Thanks for the feedback!')}</Notice><Button onPress={()=>{setSent(false);setValue('');onClose();}}>{t('ui.action.close','Close')}</Button></>:<>
      <Copy muted>{target.name?copyText("About {v0}",{v0:target.name}):t('ui.feedback.about_platform','About BuildPlay')}</Copy>
      <Choices label={t('ui.feedback.kind','Kind')} value={kind} options={[{value:'bug',label:t('ui.feedback.kind_bug','Bug')},{value:'suggestion',label:t('ui.feedback.kind_suggestion','Suggestion')},{value:'problem',label:t('ui.feedback.kind_problem','Problem')}]} onChange={setKind}/>
      <Field label={t('ui.feedback.placeholder_bug','What happened, and what did you expect?')} multiline value={value} onChangeText={setValue} maxLength={1000}/><Copy small muted>{value.length} / 1000</Copy>
      {error&&<Notice error>{error}</Notice>}
      <Button disabled={value.trim().length<5||!p.network} onPress={async()=>{if(!p.account){openAccount();return;}try{await p.actions.request('POST','/feedback',{kind,target_type:target.type,...(target.id?{target_id:target.id}:{}),text:value.trim(),page:'portal'});setSent(true);}catch(e){setError(e instanceof Error?e.message:String(e));}}}>{p.account?t('ui.feedback.send','Send feedback'):t('ui.auth.log_in','Log in to send')}</Button>
    </>}
  </Dialog>;
}
