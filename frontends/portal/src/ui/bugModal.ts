import {useSyncExternalStore,type ReactNode} from 'react';
/** Native platforms present one report inside whichever app modal already owns
 * the window. This avoids presenting a sibling UIViewController on iOS. */
const dialogs=new Map<symbol,{current:unknown}>(),listeners=new Set<()=>void>(),reportListeners=new Set<()=>void>();
let report:{content:ReactNode;onClose:()=>void}|null=null;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const reportSubscribe=(listener:()=>void)=>{reportListeners.add(listener);return()=>{reportListeners.delete(listener);};};
export function registerNativeDialog(id:symbol,target:{current:unknown}){dialogs.set(id,target);listeners.forEach(fn=>fn());return()=>{dialogs.delete(id);listeners.forEach(fn=>fn());};}
export const useNativeDialogCount=()=>useSyncExternalStore(subscribe,()=>dialogs.size,()=>0);
export const useNativeBugReport=()=>useSyncExternalStore(reportSubscribe,()=>report,()=>null);
export function setNativeBugReport(next:typeof report){report=next;reportListeners.forEach(fn=>fn());}

export function nativeBugCaptureTarget(){return Array.from(dialogs.values()).at(-1)?.current||null;}
