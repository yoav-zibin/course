import {deferredAnalytics} from '../platform/analytics-session';

export function installWebApp() {}
export const updatePortalAnalytics = deferredAnalytics(
  task => { if (typeof requestIdleCallback === 'function') requestIdleCallback(task); else setTimeout(task, 0); },
  (id, screen) => {
    try {
      (require('../platform/native-analytics') as typeof import('../platform/native-analytics')).publishNativeView(id, screen);
    } catch {
      // Optional development shells can have a different native runtime.
    }
  },
);
export async function installPrompt() {return false;}
