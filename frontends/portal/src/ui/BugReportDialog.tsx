import React,{useEffect} from 'react';
import {Dialog,DialogContent} from './components';
import {setNativeBugReport,useNativeDialogCount} from './bugModal';
export function BugReportDialog({visible,title,children,onClose,wide}: {visible:boolean;title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}) {
  const active=useNativeDialogCount();
  useEffect(()=>{setNativeBugReport(visible&&active?{content:<DialogContent title={title} onClose={onClose} wide={wide}>{children}</DialogContent>,onClose}:null);return()=>setNativeBugReport(null);},[visible,active,title,children,onClose,wide]);
  return active?null:<Dialog visible={visible} title={title} onClose={onClose} wide={wide} reporting>{children}</Dialog>;
}
