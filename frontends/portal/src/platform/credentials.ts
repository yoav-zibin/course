import {cleanAccounts} from '../core/account-data';
import { getItem, setItem } from './storage';
import type { Account } from '../core/types';
export const ACCOUNTS_KEY = 'game-platform.accounts.v1';
export const CURRENT_KEY = 'game-platform.current-account.v1';
// Browser storage is already isolated by the serving API origin. Keep these
// established keys shared with Admin and the existing browser sign-in flow.
export const currentAccountKey=(_base?:string)=>CURRENT_KEY;
export const loadCurrentAccount=(_base?:string)=>getItem(CURRENT_KEY);
export async function loadAccounts(_base?:string): Promise<Account[]> { const text = await getItem(ACCOUNTS_KEY); const value = text ? JSON.parse(text) : []; if (!Array.isArray(value)) throw new Error('Saved accounts need recovery'); const accounts=cleanAccounts(value.filter(a => typeof a?.id === 'string' && typeof a.password === 'string')); if(value.some(a=>a&&Object.hasOwn(a,'referral_code')))await setItem(ACCOUNTS_KEY,JSON.stringify(accounts)).catch(()=>{});return accounts; }
export async function saveAccounts(accounts: Account[],_base?:string): Promise<void> { await setItem(ACCOUNTS_KEY, JSON.stringify(cleanAccounts(accounts))); }
