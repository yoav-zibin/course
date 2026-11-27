// Application storage is asynchronous on every platform. Native code selects
// storage.native.ts, which keeps slow iOS disk operations on a dedicated Worklet.
interface WebStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
const browser: WebStorage = require('../../../../static/shared/device-storage.js');
export const {getItem, setItem, removeItem, keys} = browser;
let serial: Promise<unknown> = Promise.resolve();
export function exclusive<T>(name: string, run: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as any)?.locks;
  if (locks) {
    // Older Portal tabs use this origin-wide lock for their split cache and
    // migration backups. Retain the account lock too, so existing shared-app
    // tabs cannot overwrite a quota recovery with an older account snapshot.
    return locks.request('playroom-portal', () => locks.request(`buildplay-${name}`, run));
  }
  const result = serial.then(run, run); serial = result.catch(() => {}); return result;
}
