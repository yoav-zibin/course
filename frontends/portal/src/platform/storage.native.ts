import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { createPersistentStorage, type PersistentBackend } from './persistent-storage';
const native = requireOptionalNativeModule<PersistentBackend>('LegacyPortal');
const persistent = createPersistentStorage(AsyncStorage, native);
export const getItem = persistent.getItem;
export const setItem = persistent.setItem;
export const removeItem = persistent.removeItem;
export const keys = persistent.keys;
let serial: Promise<unknown> = Promise.resolve();
export function exclusive<T>(_name: string, run: () => Promise<T>): Promise<T> {
  const result = serial.then(run, run); serial = result.catch(() => {}); return result;
}
