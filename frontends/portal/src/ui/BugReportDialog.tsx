import React,{useEffect} from 'react';
import {Dialog,DialogContent} from './components';
import {setNativeBugReport,useNativeDialogCount} from './bugModal';
export function BugReportDialog({visible,title,children,onClose,wide}: {visible:boolean;title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}) {
  const active=useNativeDialogCount();
  // A draft update must reconcile the existing overlay in place. Clearing it
  // during each effect cleanup unmounts TextInput and drops keyboard focus.
  useEffect(()=>{setNativeBugReport(visible&&active?{content:<DialogContent title={title} onClose={onClose} wide={wide} avoidKeyboard>{children}</DialogContent>,onClose}:null);},[visible,active,title,children,onClose,wide]);
  useEffect(()=>()=>setNativeBugReport(null),[]);
  return active?null:<Dialog visible={visible} title={title} onClose={onClose} wide={wide} reporting>{children}</Dialog>;
}
