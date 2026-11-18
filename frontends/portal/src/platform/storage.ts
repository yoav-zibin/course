// Web keeps the established origin and auth keys so Portal/Admin remain signed in.
export async function getItem(key: string): Promise<string | null> { return globalThis.localStorage?.getItem(key) ?? null; }
export async function setItem(key: string, value: string): Promise<void> { if (!globalThis.localStorage) throw new Error('Device storage unavailable'); globalThis.localStorage.setItem(key, value); }
export async function removeItem(key: string): Promise<void> { globalThis.localStorage?.removeItem(key); }
export async function keys(): Promise<string[]> { return globalThis.localStorage ? Object.keys(globalThis.localStorage) : []; }
let serial: Promise<unknown> = Promise.resolve();
export function exclusive<T>(name: string, run: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as any)?.locks;
  if (locks) return locks.request(`buildplay-${name}`, run);
  const result = serial.then(run, run); serial = result.catch(() => {}); return result;
}
