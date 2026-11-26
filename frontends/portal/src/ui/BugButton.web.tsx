import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {MenuGlyph} from './MenuGlyph';
import {HistoryGlyph,historyButtons} from './HistoryGlyph';
import type {MatchHistoryControls} from './matchHistory';
import {copyText} from '../platform/i18n';
import {bugButtonLabel,openBugReport} from './bugControl';
import {BUG_HEIGHT,BUG_WIDTH,bugBounds,clampBugPoint,isBugDrag,matchControlsSize,normalizedBugPoint,resolveBugPoint,setBugPosition,useBugPosition,type BugPoint} from './bugPosition';
import {recordDiagnosticEvent} from '../core/diagnostics';
import {createDragFrames} from '../core/dragFrames';
/** A manual popover participates in the browser top layer. A z-index alone
 * cannot rise above fullscreen content or a modal dialog. */
export function BugButton({onMenuPress,menuExpanded=false,history}:{onMenuPress?:()=>void;menuExpanded?:boolean;history?:MatchHistoryControls}={}){
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  const [modalOpen,setModalOpen]=useState(false);
  const insets=useSafeAreaInsets(),saved=useBugPosition();
  const viewport=()=>({width:window.visualViewport?.width??window.innerWidth,height:window.visualViewport?.height??window.innerHeight,
    x:window.visualViewport?.offsetLeft??0,y:window.visualViewport?.offsetTop??0});
  const [screen,setScreen]=useState(viewport);
  const grouped=Boolean(onMenuPress),size=grouped?matchControlsSize(screen.width,insets,Boolean(history)):{width:BUG_WIDTH,height:BUG_HEIGHT},controlWidth=size.width,controlHeight=size.height;
  const bounds=bugBounds(screen.width,screen.height,insets,screen,{width:controlWidth,height:controlHeight}),point=resolveBugPoint(saved??(grouped?{x:1,y:1}:null),bounds);
  const current=useRef({bounds,point});current.current={bounds,point};
  const drag=useRef<{id:number;start:BugPoint;origin:BugPoint;next?:BugPoint}|null>(null),suppressClick=useRef(false);
  const control=useRef<HTMLDivElement>(null);
  const dragFrames=useMemo(()=>createDragFrames<BugPoint>('floating_controls'),[]);
  function moveControl(value:BugPoint){
    if(control.current)control.current.style.transform=`translate3d(${value.x}px,${value.y}px,0)`;
  }
  function placeControl(value:BugPoint){
    const bounds=current.current.bounds,placed=clampBugPoint(value,bounds);
    moveControl(placed);
    setBugPosition(normalizedBugPoint(placed,bounds));
    return placed;
  }
  useLayoutEffect(()=>{
    if(!drag.current?.next)moveControl(point);
  },[host,point.x,point.y]);
  useEffect(()=>()=>dragFrames.finish('cancelled'),[dragFrames]);
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
      setModalOpen(modals.length>0||Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
      // Modal dialogs make outside descendants inert, so the control must move
      // inside the active modal as well as rise in the browser top layer.
      const active=document.activeElement?.closest('dialog');
      const parent=(active&&modals.includes(active)?active:modals[modals.length-1])||document.fullscreenElement||document.body;
      const moved=node.parentElement!==parent;if(moved)parent.appendChild(node);
      if(typeof node.showPopover==='function'){
        try {if(promote&&node.matches(':popover-open'))node.hidePopover();if(!node.matches(':popover-open'))node.showPopover();}catch{/* Detached during an update. */}
      }else node.style.display='block';
    };
    const changed=(event:Event)=>{if(event.target!==node)place(true);};
    const observer=new MutationObserver(()=>place());
    place();setHost(node);document.addEventListener('fullscreenchange',changed);document.addEventListener('toggle',changed,true);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','role','aria-modal']});
    return()=>{observer.disconnect();document.removeEventListener('fullscreenchange',changed);document.removeEventListener('toggle',changed,true);node.remove();};
  },[]);
  const pointerHandlers=(activate:()=>void,disabled=false)=>({
    onPointerDown:(event:React.PointerEvent<HTMLButtonElement>)=>{
      if(disabled||!event.isPrimary||event.button!==0)return;
      suppressClick.current=false;
      event.currentTarget.style.setProperty('--press-background','#465572');
      drag.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},origin:current.current.point};
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove:(event:React.PointerEvent<HTMLButtonElement>)=>{
      const value=drag.current;if(!value||value.id!==event.pointerId)return;
      const dx=event.clientX-value.start.x,dy=event.clientY-value.start.y;
      if(!value.next&&!isBugDrag(dx,dy))return;
      value.next=clampBugPoint({x:value.origin.x+dx,y:value.origin.y+dy},current.current.bounds);
      suppressClick.current=true;event.preventDefault();
      dragFrames.move(value.next,moveControl);
    },
    onPointerUp:(event:React.PointerEvent<HTMLButtonElement>)=>{
      event.currentTarget.style.removeProperty('--press-background');
      const value=drag.current;if(!value||value.id!==event.pointerId)return;
      const dx=event.clientX-value.start.x,dy=event.clientY-value.start.y;
      drag.current=null;suppressClick.current=true;event.preventDefault();
      dragFrames.finish('released');
      if(value.next||isBugDrag(dx,dy)){
        const final=placeControl({x:value.origin.x+dx,y:value.origin.y+dy});
        recordDiagnosticEvent('bug_control_moved',{x:Math.round(final.x),y:Math.round(final.y)});
      }else{
        // Touch gestures inside another modal do not always produce a browser
        // compatibility click. Complete the tap on the real pointer release.
        const box=event.currentTarget.getBoundingClientRect();
        if(!disabled&&event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)activate();
      }
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onLostPointerCapture:(event:React.PointerEvent<HTMLButtonElement>)=>{
      event.currentTarget.style.removeProperty('--press-background');
      const value=drag.current;if(value?.id!==event.pointerId)return;
      drag.current=null;suppressClick.current=true;
      dragFrames.finish('cancelled');
      if(value.next)placeControl(value.next);
    },
    onClick:(event:React.MouseEvent<HTMLButtonElement>)=>{if(disabled||suppressClick.current&&event.detail!==0){suppressClick.current=false;event.preventDefault();event.stopPropagation();return;}activate();},
  });
  const buttonStyle:React.CSSProperties={flex:1,minWidth:0,height:grouped&&history?42:'100%',padding:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--press-background, transparent)',border:0,borderRadius:7,cursor:'grab',touchAction:'none',userSelect:'none'};
  return host?createPortal(<div ref={control} data-testid={grouped?'match-floating-controls':undefined} dir="ltr"
    style={{position:'absolute',top:0,left:0,width:controlWidth,height:controlHeight,boxSizing:'border-box',display:'flex',background:'#171c2a',border:'1px solid #3b4760',borderRadius:8,pointerEvents:'auto',zIndex:2147483647}}>
    <button type="button" data-testid="bug-report-button" aria-label={bugButtonLabel()} title={bugButtonLabel()} {...pointerHandlers(openBugReport)} style={buttonStyle}><BugGlyph/></button>
    {onMenuPress&&<button type="button" data-testid="match-menu-button" aria-label={copyText('Match menu')} title={copyText('Match menu')} aria-expanded={menuExpanded} {...pointerHandlers(onMenuPress)} style={buttonStyle}><MenuGlyph/></button>}
    {grouped&&history&&historyButtons({...history,disabled:history.disabled||modalOpen}).map(control=><button key={control.id} type="button" data-testid={control.id} aria-label={control.label} title={control.label} disabled={control.disabled}
      {...pointerHandlers(()=>{recordDiagnosticEvent('press',{label:control.label});control.onPress();},control.disabled)} style={{...buttonStyle,opacity:control.disabled?.35:1,cursor:control.disabled?'default':'grab'}}><HistoryGlyph kind={control.kind}/></button>)}
    {grouped&&history&&<span data-testid="history-status" aria-live="polite" style={{position:'absolute',left:4,right:4,bottom:2,height:17,fontSize:11,lineHeight:'16px',textAlign:'center',color:'#b8c2d5',pointerEvents:'none',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{history.atEnd?copyText('Live board'):copyText('Replay · move {v0} of {v1}',{v0:history.position,v1:history.total})}</span>}
  </div>,host):null;
}
