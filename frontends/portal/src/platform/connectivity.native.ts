import * as Network from 'expo-network';
let online = true;
export function isOnline(): boolean { return online; }
export function watchConnectivity(listener: (value: boolean) => void): () => void {
  const update = (state: Network.NetworkState) => { online = state.isConnected !== false && state.isInternetReachable !== false; listener(online); };
  Network.getNetworkStateAsync().then(update).catch(() => {});
  const subscription = Network.addNetworkStateListener(update); return () => subscription.remove();
}
