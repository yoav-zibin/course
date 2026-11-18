import type {Portal} from './context';
let prompt:any=null;
export function installWebApp() {
  if(document.querySelector('meta[name="local-preview"]'))return;
  // Preserve the existing portal's Google tag on the production web shell.
  // Local tests and embedded game hosts never send analytics events.
  if (location.hostname === 'buildplay.fun') {
    const analytics = window as typeof window & {dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void};
    if (!analytics.gtag) {
      analytics.dataLayer = analytics.dataLayer || [];
      analytics.gtag = function () { analytics.dataLayer!.push(arguments); };
      analytics.gtag('js', new Date());
      analytics.gtag('config', 'G-6CCXZQYVE7', {page_location: location.origin + location.pathname});
      const tag = document.createElement('script');
      tag.async = true; tag.src = 'https://www.googletagmanager.com/gtag/js?id=G-6CCXZQYVE7';
      document.head.appendChild(tag);
    }
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
  if('serviceWorker' in navigator) void navigator.serviceWorker.register('/portal-worker.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
}
export async function installPrompt() {if(!prompt)return false;await prompt.prompt();await prompt.userChoice;prompt=null;return true;}
export async function enableNotifications(p:Portal) {
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('This browser does not support push notifications. On iPhone, add BuildPlay to your Home Screen first.');
  const config=await p.actions.request('GET','/push/config');if(!config.enabled)throw new Error('Turn notifications are not enabled on this server.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Allow notifications in your browser settings to receive turn alerts.');
  await navigator.serviceWorker.register('/portal-worker.js',{scope:'/'});
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  const base64=config.vapid_public_key.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=Uint8Array.from(atob(base64+'='.repeat((4-base64.length%4)%4)),c=>c.charCodeAt(0));
  subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  const json=subscription.toJSON();
  await p.actions.request('POST','/push/subscriptions',{endpoint:json.endpoint,keys:json.keys,expiration_time:subscription.expirationTime?new Date(subscription.expirationTime).toISOString():null});
}
