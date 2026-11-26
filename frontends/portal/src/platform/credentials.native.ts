import * as SecureStore from 'expo-secure-store';
import { getItem, setItem } from './storage';
import type { Account } from '../core/types';
import {createCredentialVault,credentialKeys} from './credential-vault';
const vault=(base?:string)=>createCredentialVault(base,{getItem,setItem},{
  getItem:key=>SecureStore.getItemAsync(key),
  setItem:(key,password)=>SecureStore.setItemAsync(key,password,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY}),
});
export const currentAccountKey=(base?:string)=>credentialKeys(base).current;
export const loadCurrentAccount=(base?:string)=>vault(base).loadCurrentAccount();
export const loadAccounts=(base?:string)=>vault(base).loadAccounts();
export const saveAccounts=(accounts:Account[],base?:string)=>vault(base).saveAccounts(accounts);
