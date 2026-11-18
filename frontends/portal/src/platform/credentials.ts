import { getItem, setItem } from './storage';
import type { Account } from '../core/types';
export const ACCOUNTS_KEY = 'game-platform.accounts.v1';
export const CURRENT_KEY = 'game-platform.current-account.v1';
export async function loadAccounts(): Promise<Account[]> { const text = await getItem(ACCOUNTS_KEY); const value = text ? JSON.parse(text) : []; if (!Array.isArray(value)) throw new Error('Saved accounts need recovery'); return value.filter(a => typeof a?.id === 'string' && typeof a.password === 'string'); }
export async function saveAccounts(accounts: Account[]): Promise<void> { await setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }
