import * as SecureStore from 'expo-secure-store';
import { getItem, setItem } from './storage';
import type { Account } from '../core/types';
export const ACCOUNTS_KEY = 'game-platform.accounts.v1';
export const CURRENT_KEY = 'game-platform.current-account.v1';
const secureKey = (id: string) => 'buildplay.account.' + Array.from(id).map(c => c.charCodeAt(0).toString(16)).join('-');
export async function loadAccounts(): Promise<Account[]> {
  const text = await getItem(ACCOUNTS_KEY); const metadata = text ? JSON.parse(text) : [];
  if (!Array.isArray(metadata)) throw new Error('Saved accounts need recovery');
  const accounts: Account[] = [];
  for (const item of metadata) { const password = await SecureStore.getItemAsync(secureKey(item.id)); if (password) accounts.push({ ...item, password }); }
  return accounts;
}
export async function saveAccounts(accounts: Account[]): Promise<void> {
  for (const account of accounts) await SecureStore.setItemAsync(secureKey(account.id), account.password, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  // Credentials never enter AsyncStorage or the game runtime. Orphaned secure entries
  // are retained on logout for recovery, but absent from the selectable account index.
  await setItem(ACCOUNTS_KEY, JSON.stringify(accounts.map(({ password: _password, ...metadata }) => metadata)));
}
