import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { createPersistentStorage } from './persistent-storage';
import {CAMPAIGN_KEY,VISITOR_KEY} from './request-storage-keys';
import {createWorkletStorage, type StorageInstaller} from './storage-worklet.native';

// All app code must use this asynchronous storage API. Direct storage access
// has stalled iOS checker drops for seconds. Keep it off the RN and UI threads.
export const supportsBrowserImports = false;
const native = requireOptionalNativeModule<StorageInstaller>('LegacyPortal');
const persistent = createPersistentStorage(AsyncStorage, native && createWorkletStorage(native), new Set([VISITOR_KEY,CAMPAIGN_KEY]));
export const getItem = persistent.getItem;
export const setItem = persistent.setItem;
export const removeItem = persistent.removeItem;
export const keys = persistent.keys;
// This separate key can be written without entering the account transaction.
export const turnStorage = {getItem,setItem,removeItem};
let serial: Promise<unknown> = Promise.resolve();
export function exclusive<T>(_name: string, run: () => Promise<T>): Promise<T> {
  const result = serial.then(run, run); serial = result.catch(() => {}); return result;
}
