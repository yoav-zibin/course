import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {bugButtonLabel,openBugReport} from './bugControl';
import {BUG_HEIGHT,BUG_WIDTH,bugBounds,clampBugPoint,isBugDrag,normalizedBugPoint,resolveBugPoint,setBugPosition,useBugPosition,type BugPoint} from './bugPosition';
import {recordDiagnosticEvent} from '../core/diagnostics';
/** A manual popover participates in the browser top layer. A z-index alone
 * cannot rise above fullscreen content or a modal dialog. */
export function BugButton(){
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  const insets=useSafeAreaInsets(),saved=useBugPosition();
  const viewport=()=>({width:window.visualViewport?.width??window.innerWidth,height:window.visualViewport?.height??window.innerHeight,
    x:window.visualViewport?.offsetLeft??0,y:window.visualViewport?.offsetTop??0});
  const [screen,setScreen]=useState(viewport);
  const bounds=bugBounds(screen.width,screen.height,insets,screen),point=resolveBugPoint(saved,bounds);
  const current=useRef({bounds,point});current.current={bounds,point};
  const drag=useRef<{id:number;start:BugPoint;origin:BugPoint;moved:boolean}|null>(null),suppressClick=useRef(false);
  useEffect(()=>{
    const resized=()=>setScreen(viewport());
    window.addEventListener('resize',resized);window.visualViewport?.addEventListener('resize',resized);window.visualViewport?.addEventListener('scroll',resized);
    return()=>{window.removeEventListener('resize',resized);window.visualViewport?.removeEventListener('resize',resized);window.visualViewport?.removeEventListener('scroll',resized);};
  },[]);
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
  return host?createPortal(<button type="button" data-testid="bug-report-button" aria-label={bugButtonLabel()} title={bugButtonLabel()}
    onPointerDown={event=>{
      if(!event.isPrimary||event.button!==0)return;
      suppressClick.current=false;
      drag.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},origin:current.current.point,moved:false};
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event=>{
      const value=drag.current;if(!value||value.id!==event.pointerId)return;
      const dx=event.clientX-value.start.x,dy=event.clientY-value.start.y;
      if(!value.moved&&!isBugDrag(dx,dy))return;
      value.moved=true;suppressClick.current=true;event.preventDefault();
      setBugPosition(normalizedBugPoint({x:value.origin.x+dx,y:value.origin.y+dy},current.current.bounds));
    }}
    onPointerUp={event=>{
      const value=drag.current;if(!value||value.id!==event.pointerId)return;
      const dx=event.clientX-value.start.x,dy=event.clientY-value.start.y;
      drag.current=null;suppressClick.current=true;event.preventDefault();
      if(value.moved||isBugDrag(dx,dy)){
        const final=clampBugPoint({x:value.origin.x+dx,y:value.origin.y+dy},current.current.bounds);
        setBugPosition(normalizedBugPoint(final,current.current.bounds));
        recordDiagnosticEvent('bug_control_moved',{x:Math.round(final.x),y:Math.round(final.y)});
      }else{
        // Touch gestures inside another modal do not always produce a browser
        // compatibility click. Complete the tap on the real pointer release.
        const box=event.currentTarget.getBoundingClientRect();
        if(event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)openBugReport();
      }
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={event=>{if(drag.current?.id===event.pointerId){drag.current=null;suppressClick.current=true;}}}
    onClick={event=>{if(suppressClick.current&&event.detail!==0){suppressClick.current=false;event.preventDefault();event.stopPropagation();return;}openBugReport();}}
    style={{position:'absolute',top:point.y,left:point.x,width:BUG_WIDTH,height:BUG_HEIGHT,padding:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#171c2a',border:'1px solid #3b4760',borderRadius:8,cursor:'grab',pointerEvents:'auto',touchAction:'none',userSelect:'none',zIndex:2147483647}}><BugGlyph/></button>,host):null;
}
