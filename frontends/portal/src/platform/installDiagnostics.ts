import {Platform} from 'react-native';
import {recordDiagnosticEvent,recordDiagnosticLog} from '../core/diagnostics';

// Installed before App mounts, so startup failures are included in a report.
for(const level of ['debug','log','info','warn','error'] as const) {
  const original=console[level].bind(console);
  console[level]=(...args:unknown[])=>{try{recordDiagnosticLog(level,...args);}catch{/* Diagnostics cannot interrupt the app. */}original(...args);};
}
if(Platform.OS==='web') {
  window.addEventListener('error',event=>recordDiagnosticLog('error',event.error||event.message));
  window.addEventListener('unhandledrejection',event=>recordDiagnosticLog('error',event.reason));
  window.addEventListener('online',()=>recordDiagnosticEvent('network_online'));
  window.addEventListener('offline',()=>recordDiagnosticEvent('network_offline'));
  document.addEventListener('visibilitychange',()=>recordDiagnosticEvent('visibility',{state:document.visibilityState}));
  document.addEventListener('click',event=>{
    const element=(event.target as Element|null)?.closest?.('[role="button"],button,a');
    if(!element)return;
    // Capture only control labels. Inputs and their values are never observed.
    const label=element.getAttribute('aria-label')||element.getAttribute('data-testid')||element.textContent||'';
    recordDiagnosticEvent('press',{label:label.slice(0,120)});
  },true);
} else {
  const errors=(globalThis as any).ErrorUtils, previous=errors?.getGlobalHandler?.();
  if(previous)errors.setGlobalHandler((error:Error,fatal:boolean)=>{recordDiagnosticLog('error',error);previous(error,fatal);});
}
