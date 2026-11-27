import {portal} from '../core';

type AnalyticsWindow = Window & {BuildPlayAnalytics?: {setUser(id: string | null): void}};

let installed = false;
let prompt:any=null;

function observeAnalyticsUser() {
  const browser = window as AnalyticsWindow;
  let requested = false;
  let current: string | null = null;
  function requestController() {
    if (!current) { requested = false; return; }
    const script = document.createElement('script');
    script.async = true;
    script.fetchPriority = 'low';
    script.src = '/static/analytics.js?v=3';
    script.onload = () => browser.BuildPlayAnalytics?.setUser(current);
    script.onerror = () => { requested = false; };
    document.head.appendChild(script);
  }
  function sync() {
    const {account} = portal.getSnapshot();
    const id = account?.canonical_user_id || account?.id || null;
    if (id === current) return;
    current = id;
    if (browser.BuildPlayAnalytics) {
      browser.BuildPlayAnalytics.setUser(current);
    } else if (id && !requested) {
      requested = true;
      if (window.requestIdleCallback) window.requestIdleCallback(requestController);
      else window.setTimeout(requestController, 0);
    }
  }
  portal.subscribe(sync);
  sync();
}

export function installWebApp() {
  if (installed || document.querySelector('meta[name="local-preview"]')) return;
  installed = true;
  if (location.hostname === 'buildplay.fun') observeAnalyticsUser();
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
  if('serviceWorker' in navigator) void navigator.serviceWorker.register('/portal-worker.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
}
export async function installPrompt() {if(!prompt)return false;await prompt.prompt();prompt=null;return true;}
