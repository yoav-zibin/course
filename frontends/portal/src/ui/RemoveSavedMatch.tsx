import {visibleErrorMessage} from '../core/account-scope';
import React,{useEffect,useRef,useState} from 'react';
import type {Match} from '../core/types';
import {copyText} from '../platform/i18n';
import {Button,Copy,Dialog,Notice} from './components';
import {useApp} from './context';

/** Removing an unsynced device branch is distinct from deleting its cloud
 * match. Keep this confirmation shared by the list and the saved board. */
export function RemoveSavedMatch({match,onRemoved}: {match:Match;onRemoved?:()=>void}) {
  const {p,run}=useApp();
  const local=p.localMatches.find(saved=>saved.id===match.id);
  const available=Boolean(local&&(local.cloud_pending||local.pending||local.conflict));
  const [confirmation,setConfirmation]=useState<Match|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const scope=JSON.stringify([p.baseUrl,p.account?.id,match.id]),current=useRef(scope),intent=useRef(0);current.current=scope;
  const close=()=>{intent.current++;setConfirmation(null);setError('');setBusy(false);};
  useEffect(close,[scope]);
  useEffect(()=>()=>{intent.current++;},[]);
  const confirm=()=>run(async()=>{
    const target=confirmation,epoch=intent.current,owner=scope;
    if(!target||busy||owner!==current.current)return;
    setBusy(true);setError('');
    try{
      const removedSelected=await p.actions.removeSavedMatch(target.id,target);
      // Clearing the selected board unmounts this component. The store reports
      // whether that removal still owns navigation after the durable write.
      if(owner===current.current&&removedSelected)onRemoved?.();
      if(epoch===intent.current&&owner===current.current)close();
    }catch(failure){
      if(epoch===intent.current&&owner===current.current)setError(visibleErrorMessage(failure)??'');
      throw failure;
    }finally{if(epoch===intent.current&&owner===current.current)setBusy(false);}
  });
  return <>
    {available&&<Button secondary compact onPress={()=>{setError('');setConfirmation(JSON.parse(JSON.stringify(local)));}}>{copyText('Remove saved copy…')}</Button>}
    <Dialog visible={confirmation!==null} title={copyText('Remove this saved copy?')} onClose={close}>
      <Copy>{copyText("This stops syncing this copy and removes it from this device's match list. A recovery copy is kept in Preserved previous app data. Any cloud match stays unchanged.")}</Copy>
      {error&&<Notice error>{error}</Notice>}
      <Button danger disabled={busy} onPress={confirm}>{copyText('Remove saved copy')}</Button>
    </Dialog>
  </>;
}
