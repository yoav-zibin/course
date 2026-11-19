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
