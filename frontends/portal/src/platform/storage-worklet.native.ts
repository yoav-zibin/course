import {createWorkletRuntime, runOnRuntimeAsync} from 'react-native-worklets';
import type {StorageBackend} from './persistent-storage';

type Operation = 'get' | 'set' | 'remove' | 'keys';
interface StorageBinding {
  access(operation: Operation, key: string, value: string): string | null;
}
export interface StorageInstaller { installStorageWorklet(): void }

function access(binding: StorageBinding, operation: Operation, key: string, value: string) {
  'worklet';
  return binding.access(operation, key, value);
}
function listKeys(binding: StorageBinding): string[] {
  'worklet';
  return JSON.parse(binding.access('keys', '', '')!);
}

// The host object holds only the platform file store. Disk access and native
// envelope encoding run on this dedicated worker, including for large saves.
export function createWorkletStorage(installer: StorageInstaller): StorageBackend {
  function initialize() {
    installer.installStorageWorklet();
    const globals = globalThis as typeof globalThis & {__buildPlayStorageBinding?: StorageBinding};
    const binding = globals.__buildPlayStorageBinding;
    if (!binding) throw new Error('Could not initialize device storage');
    delete globals.__buildPlayStorageBinding;
    const runtime = createWorkletRuntime({name: 'Device storage', enableEventLoop: false});
    return {binding, runtime};
  }
  let worker: ReturnType<typeof initialize> | undefined;
  function perform(operation: 'get' | 'set' | 'remove', key: string, value = '') {
    const {binding, runtime} = worker ??= initialize();
    return runOnRuntimeAsync(runtime, access, binding, operation, key, value);
  }
  return {
    getItem: key => perform('get', key),
    async setItem(key, value) { await perform('set', key, value); },
    async removeItem(key) { await perform('remove', key); },
    async getAllKeys() {
      const {binding, runtime} = worker ??= initialize();
      return runOnRuntimeAsync(runtime, listKeys, binding);
    },
  };
}
