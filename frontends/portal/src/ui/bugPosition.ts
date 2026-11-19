import {useSyncExternalStore} from 'react';

export const BUG_WIDTH=36, BUG_HEIGHT=32;
export type BugPoint={x:number;y:number};
export type BugBounds={left:number;top:number;right:number;bottom:number};
type Insets={top:number;right:number;bottom:number;left:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Keep the entire control inside the visible viewport and its safe area. */
export function bugBounds(width:number,height:number,insets:Insets,origin:BugPoint={x:0,y:0}):BugBounds {
  const left=origin.x+Math.min(insets.left+5,Math.max(0,width-BUG_WIDTH));
  const top=origin.y+Math.min(insets.top+2,Math.max(0,height-BUG_HEIGHT));
  return {left,top,right:Math.max(left,origin.x+width-insets.right-5-BUG_WIDTH),
    bottom:Math.max(top,origin.y+height-insets.bottom-2-BUG_HEIGHT)};
}
export function clampBugPoint(point:BugPoint,bounds:BugBounds):BugPoint {
  return {x:clamp(point.x,bounds.left,bounds.right),y:clamp(point.y,bounds.top,bounds.bottom)};
}
export function normalizedBugPoint(point:BugPoint,bounds:BugBounds):BugPoint {
  const value=clampBugPoint(point,bounds);
  return {x:bounds.right===bounds.left?0:(value.x-bounds.left)/(bounds.right-bounds.left),
    y:bounds.bottom===bounds.top?0:(value.y-bounds.top)/(bounds.bottom-bounds.top)};
}
export function resolveBugPoint(saved:BugPoint|null,bounds:BugBounds):BugPoint {
  return saved?clampBugPoint({x:bounds.left+saved.x*(bounds.right-bounds.left),
    y:bounds.top+saved.y*(bounds.bottom-bounds.top)},bounds):{x:bounds.left,y:bounds.top};
}
export const isBugDrag=(dx:number,dy:number)=>dx*dx+dy*dy>25;

// Preferences only, kept for this app session. Every native Modal and the root
// control share one normalized position, including after rotation or resizing.
let position:BugPoint|null=null;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function setBugPosition(next:BugPoint) {
  if(position?.x===next.x&&position?.y===next.y)return;
  position=next;listeners.forEach(listener=>listener());
}
export const useBugPosition=()=>useSyncExternalStore(subscribe,()=>position,()=>null);
