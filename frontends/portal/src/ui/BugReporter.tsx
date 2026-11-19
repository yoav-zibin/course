import {copyText} from '../platform/i18n';
import React,{useEffect,useRef,useState} from 'react';
import {Image,Platform,useWindowDimensions} from 'react-native';
import Constants from 'expo-constants';
import {Button,Copy,Field,Notice} from './components';
import {BugReportDialog} from './BugReportDialog';
import {configureBugControl} from './bugControl';
import {captureBugScreenshot} from '../platform/screenshot';
import {diagnosticPath,diagnosticSnapshot,recordDiagnosticEvent,recordDiagnosticLog} from '../core/diagnostics';
import type {PortalState} from '../core/types';

type Portal=PortalState&{actions:{request:(method:string,path:string,body?:unknown)=>Promise<any>}};

// Native reports are presented inside the already-open Modal. Keep the input's
// state in that rendered tree: relaying each controlled value through the
// parent/modal effect can overwrite newer native keystrokes with an older value.
function BugReportForm({p,screenshot,captureError,captured,draft,onClose,onSent}: {
  p:Portal;screenshot:string|null;captureError:string;captured:{current:Record<string,unknown>};
  draft:{current:string};onClose:()=>void;onSent:(submittedText:string)=>void;
}) {
  const [text,setText]=useState(draft.current),[error,setError]=useState(''),[sent,setSent]=useState('');
  return sent?<><Notice>{copyText("Thanks! Your report was sent.")}</Notice><Copy small muted>{copyText("Report {v0}",{v0:sent})}</Copy><Button onPress={onClose}>{copyText("Close")}</Button></>:<>
    <Copy muted>{copyText("Describe what happened, what you expected, or the feature you would like.")}</Copy>
    {screenshot&&<Image source={{uri:screenshot}} accessibilityLabel={copyText("Screenshot captured before opening this report")} resizeMode="contain" style={{width:'100%',height:220,borderRadius:8,backgroundColor:'#10141f'}}/>}
    {captureError&&<Notice error>{copyText("Screenshot unavailable: {v0}",{v0:captureError})}</Notice>}
    <Copy small muted>{copyText("Your screenshot, recent app logs, errors, API timings, pages, device details, and account identity will be included. Passwords and API request bodies are excluded from diagnostics.")}</Copy>
    <Field label={copyText("Bug or feature request")} multiline value={text} onChangeText={value=>{draft.current=value;setText(value);}} maxLength={10000}/>
    {error&&<Notice error>{error}</Notice>}
    <Button disabled={text.trim().length<5||!p.network} onPress={async()=>{
      try{const result=await p.actions.request('POST','/bug-reports',{text:text.trim(),screenshot,diagnostics:diagnosticSnapshot({...captured.current.context as Record<string,unknown>,screenshotCapturedAt:captured.current.capturedAt})});recordDiagnosticEvent('bug_report_sent',{id:result.id});onSent(text);setSent(result.id);}
      catch(e){setError(e instanceof Error?e.message:String(e));}
    }}>{copyText("Send report")}</Button>
  </>;
}

export function BugReporter({p,screen}: {p:Portal;screen:string}) {
  const [visible,setVisible]=useState(false),[screenshot,setScreenshot]=useState<string|null>(null),[captureError,setCaptureError]=useState('');
  const draft=useRef(''),submitted=useRef(false);
  const busy=useRef(false),opened=useRef(false),captured=useRef<Record<string,unknown>>({});
  const current=useRef({p,screen});current.current={p,screen};
  const dimensions=useWindowDimensions();
  useEffect(()=>configureBugControl(()=>{
    if(busy.current||opened.current)return;
    busy.current=true;recordDiagnosticEvent('bug_capture_started');
    const context=current.current;
    void (async()=>{
      let image:string|null=null,failure='';
      try{let timer:ReturnType<typeof setTimeout>;try{image=await Promise.race([captureBugScreenshot(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Screenshot capture timed out. You can still send the report.')),8000);})]);}finally{clearTimeout(timer!);}}catch(e){failure=e instanceof Error?e.message:String(e);recordDiagnosticLog('error','screenshot_capture',e);}
      captured.current=diagnosticSnapshot({platform:Platform.OS,platformVersion:Platform.Version,appVersion:Constants.expoConfig?.version,expoSdk:Constants.expoConfig?.sdkVersion,
        nativeBuild:Platform.OS==='ios'?Constants.platform?.ios?.buildNumber:Platform.OS==='android'?Constants.platform?.android?.versionCode:undefined,
        user:context.p.account?{id:context.p.account.id,displayName:context.p.account.display_name}:null,locale:context.p.locale,screen:context.screen,
        gameId:context.p.game?.id||context.p.selectedGameId,gameVersion:context.p.game?.version,matchId:context.p.selectedMatch?.id,matchStatus:context.p.selectedMatch?.status,moveCount:context.p.selectedMatch?.move_count,
        network:context.p.network,pending:context.p.pending,viewport:dimensions,screenshotError:failure||undefined,
        ...(Platform.OS==='web'?{userAgent:navigator.userAgent,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,online:navigator.onLine,
          webAssets:Array.from(document.scripts).filter(script=>script.src&&new URL(script.src).origin===location.origin).map(script=>diagnosticPath(script.src)).slice(0,20)}:{}),
      });
      setScreenshot(image);setCaptureError(failure);submitted.current=false;opened.current=true;setVisible(true);busy.current=false;
    })();
  }),[dimensions.width,dimensions.height]);
  const close=()=>{opened.current=false;setVisible(false);if(submitted.current)setScreenshot(null);recordDiagnosticEvent('bug_report_closed');};
  return <BugReportDialog visible={visible} title={copyText("Report a bug or feature request")} onClose={close} wide>
    <BugReportForm p={p} screenshot={screenshot} captureError={captureError} captured={captured} draft={draft} onClose={close} onSent={submittedText=>{
      // A late response must not erase edits made while it was in flight.
      if(draft.current===submittedText)draft.current='';
      submitted.current=true;
    }}/>
  </BugReportDialog>;
}
