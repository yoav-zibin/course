import {deferredAnalytics} from '../platform/analytics-session';

export function installWebApp() {}
export const updatePortalAnalytics = deferredAnalytics(
  task => { if (typeof requestIdleCallback === 'function') requestIdleCallback(task); else setTimeout(task, 0); },
  (id, screen) => {
    try {
      const {publishNativeView} = require('../platform/native-analytics') as typeof import('../platform/native-analytics');
      void publishNativeView(id, screen)?.catch(() => {});
    } catch {
      // Optional development shells can have a different native runtime.
    }
  },
);
export async function installPrompt() {return false;}
