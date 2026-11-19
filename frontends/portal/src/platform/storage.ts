// Web keeps the established origin and auth keys so Portal/Admin remain signed in.
export async function getItem(key: string): Promise<string | null> { return globalThis.localStorage?.getItem(key) ?? null; }
export async function setItem(key: string, value: string): Promise<void> { if (!globalThis.localStorage) throw new Error('Device storage unavailable'); globalThis.localStorage.setItem(key, value); }
export async function removeItem(key: string): Promise<void> { globalThis.localStorage?.removeItem(key); }
export async function keys(): Promise<string[]> { return globalThis.localStorage ? Object.keys(globalThis.localStorage) : []; }
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
