import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {BugGlyph} from './BugGlyph';
import {bugButtonLabel,openBugReport} from './bugControl';
/** A manual popover participates in the browser top layer. A z-index alone
 * cannot rise above fullscreen content or a modal dialog. */
export function BugButton(){
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  useEffect(()=>{
    const node=document.createElement('div');node.setAttribute('data-bug-overlay','true');node.setAttribute('popover','manual');
    Object.assign(node.style,{position:'fixed',inset:'0',width:'100%',height:'100%',margin:'0',padding:'0',border:'0',background:'transparent',pointerEvents:'none',zIndex:'2147483647',overflow:'visible'});
    const place=(promote=false)=>{
      const modals=Array.from(document.querySelectorAll('dialog[open]')).filter(dialog=>{try{return dialog.matches(':modal');}catch{return true;}});
      // Modal dialogs make outside descendants inert, so the control must move
      // inside the active modal as well as rise in the browser top layer.
      const active=document.activeElement?.closest('dialog');
      const parent=(active&&modals.includes(active)?active:modals.at(-1))||document.fullscreenElement||document.body;
      const moved=node.parentElement!==parent;if(moved)parent.appendChild(node);
      if(typeof node.showPopover==='function'){
        try {if(promote&&node.matches(':popover-open'))node.hidePopover();if(!node.matches(':popover-open'))node.showPopover();}catch{/* Detached during an update. */}
      }else node.style.display='block';
    };
    const changed=(event:Event)=>{if(event.target!==node)place(true);};
    const observer=new MutationObserver(()=>place());
    place();setHost(node);document.addEventListener('fullscreenchange',changed);document.addEventListener('toggle',changed,true);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
    return()=>{observer.disconnect();document.removeEventListener('fullscreenchange',changed);document.removeEventListener('toggle',changed,true);node.remove();};
  },[]);
  return host?createPortal(<button type="button" data-testid="bug-report-button" aria-label={bugButtonLabel()} title={bugButtonLabel()} onClick={openBugReport} style={{position:'absolute',top:'max(2px, env(safe-area-inset-top))',left:5,width:36,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#171c2a',border:'1px solid #3b4760',borderRadius:8,cursor:'pointer',pointerEvents:'auto',zIndex:2147483647}}><BugGlyph/></button>,host):null;
}
