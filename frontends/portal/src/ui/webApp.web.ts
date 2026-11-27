import {deferredAnalytics, type AnalyticsScreen} from '../platform/analytics-session';

type AnalyticsWindow = Window & {BuildPlayAnalytics?: {setPortalView(id: string | null, screen: AnalyticsScreen): void}};

let installed = false;
let prompt:any=null;

let requested = false;
let current: string | null = null;
let visible: AnalyticsScreen = 'games';
export const updatePortalAnalytics = deferredAnalytics(
  task => { if (window.requestIdleCallback) window.requestIdleCallback(task); else window.setTimeout(task, 0); },
  (id, screen) => {
    if (location.hostname !== 'buildplay.fun' || document.querySelector('meta[name="local-preview"]')) return;
    const browser = window as AnalyticsWindow;
    current = id;
    visible = screen;
    if (browser.BuildPlayAnalytics) {
      browser.BuildPlayAnalytics.setPortalView(current, visible);
      return;
    }
    if (requested || !id) return;
    requested = true;
    const script = document.createElement('script');
    script.async = true;
    script.fetchPriority = 'low';
    script.src = '/static/analytics.js?v=5';
    script.onload = () => browser.BuildPlayAnalytics?.setPortalView(current, visible);
    script.onerror = () => { requested = false; };
    document.head.appendChild(script);
  },
);

export function installWebApp() {
  if (installed || document.querySelector('meta[name="local-preview"]')) return;
  installed = true;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
  if('serviceWorker' in navigator) void navigator.serviceWorker.register('/portal-worker.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
}
export async function installPrompt() {if(!prompt)return false;await prompt.prompt();prompt=null;return true;}
