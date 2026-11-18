import {copyText} from '../platform/i18n';
import React, {useEffect, useRef, useState} from 'react';
import {Copy, Notice} from './components';

let loading: Promise<void> | null = null;
export default function GoogleLogin({clientId,onToken}: {clientId:string;onToken:(token:string)=>Promise<unknown>;link?:boolean}) {
  const holder=useRef<HTMLDivElement>(null),callback=useRef(onToken);callback.current=onToken;
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;
    loading ||= new Promise((resolve,reject)=>{if((window as any).google?.accounts?.id){resolve();return;}const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=()=>resolve();script.onerror=()=>{loading=null;reject(new Error(copyText("Could not load Google sign-in. Check your connection.")));};document.head.appendChild(script);});
    void loading.then(()=>{if(!active||!holder.current)return;const google=(window as any).google.accounts.id;google.initialize({client_id:clientId,callback:(result:any)=>{void callback.current(result.credential).catch((e:Error)=>setError(e.message));}});google.renderButton(holder.current,{theme:'filled_black',size:'large',width:280});}).catch((e:Error)=>active&&setError(e.message));
    return()=>{active=false;};
  },[clientId]);
  return <><div ref={holder} style={{minHeight:44}} />{error&&<Notice error>{error}</Notice>}</>;
}
