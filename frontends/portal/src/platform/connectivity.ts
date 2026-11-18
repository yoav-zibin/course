export function isOnline(): boolean { return globalThis.navigator?.onLine !== false; }
export function watchConnectivity(listener: (online: boolean) => void): () => void {
  const update = () => listener(isOnline());
  globalThis.addEventListener?.('online', update); globalThis.addEventListener?.('offline', update);
  return () => { globalThis.removeEventListener?.('online', update); globalThis.removeEventListener?.('offline', update); };
}
