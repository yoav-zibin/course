import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ScrollView,View} from 'react-native';
import {Button,Row,Title,colors} from './components';
import {copyText} from '../platform/i18n';

/** A true browser modal also covers fullscreen content and any previously
 * opened native dialog. The bug control is promoted above it independently. */
export function BugReportDialog({visible,title,children,onClose}: {visible:boolean;title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}) {
  const [host,setHost]=useState<HTMLDialogElement|null>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const node=document.createElement('dialog');node.setAttribute('aria-label',title);node.setAttribute('data-bug-report-dialog','true');
    Object.assign(node.style,{color:colors.text,position:'fixed',inset:'0',margin:'auto',padding:'22px',width:'min(760px, calc(100vw - 36px))',maxWidth:'calc(100vw - 36px)',maxHeight:'90dvh',boxSizing:'border-box',background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:'16px',zIndex:'2147483646',overflow:'auto'});
    const css=document.createElement('style');css.textContent='dialog[data-bug-report-dialog]::backdrop{background:#050915bb}';document.head.appendChild(css);
    const cancel=(event:Event)=>{event.preventDefault();close.current();};node.addEventListener('cancel',cancel);document.body.appendChild(node);setHost(node);
    return()=>{node.removeEventListener('cancel',cancel);node.remove();css.remove();};
  },[]);
  useEffect(()=>{if(!host)return;host.setAttribute('aria-label',title);if(visible){const parent=document.fullscreenElement||document.body;if(host.parentElement!==parent)parent.appendChild(host);if(!host.open)host.showModal();}else if(host.open)host.close();},[host,visible,title]);
  return host&&visible?createPortal(<View style={{gap:22}}><Row style={{justifyContent:'space-between'}}><Title small>{title}</Title><Button compact secondary label={copyText('Close dialog')} onPress={onClose}>×</Button></Row><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:18,paddingBottom:10}}>{children}</ScrollView></View>,host):null;
}
