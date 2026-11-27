import {portal} from '../core';

const measurementId = 'G-6CCXZQYVE7';
const disableKey = `ga-disable-${measurementId}` as const;
type AnalyticsWindow = Window & {
  dataLayer?: IArguments[];
  gtag?: (...args: unknown[]) => void;
  [disableKey]?: boolean;
};

let installed = false;
let prompt:any=null;

function observeAnalyticsUser() {
  const analytics = window as AnalyticsWindow;
  let currentUserId: string | null = null;
  let pausedForSignOut = false;

  const sync = () => {
    const {account} = portal.getSnapshot();
    const userId = account?.canonical_user_id || account?.id || null;
    if (userId === currentUserId) return;
    currentUserId = userId;

    if (analytics.gtag) {
      if (!userId && analytics[disableKey] !== true) {
        analytics[disableKey] = true;
        pausedForSignOut = true;
      }
      analytics.gtag('config', measurementId, {user_id: userId, update: true});
      if (userId && pausedForSignOut) {
        analytics[disableKey] = false;
        pausedForSignOut = false;
      }
      return;
    }
    if (!userId) return;

    analytics.dataLayer = analytics.dataLayer || [];
    analytics.gtag = function () {
      analytics.dataLayer!.push(arguments);
    };
    analytics.gtag('js', new Date());
    analytics.gtag('config', measurementId, {
      user_id: userId,
      page_location: location.origin + location.pathname,
    });
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(tag);
  };

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
