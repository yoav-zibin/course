import type {Account} from './types';

/** Keep retired personal referral codes out of stored account metadata. */
export function withoutPersonalReferral<T extends Record<string,unknown>>(account:T):T {
  const {referral_code:_retired,...current}=account;
  return current as T;
}
export function cleanAccounts(accounts:Account[]):Account[]{return accounts.map(withoutPersonalReferral);}

export function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
