import type {Account} from './types';

/** Keep retired personal referral codes out of stored account metadata. */
export function withoutPersonalReferral<T extends Record<string,unknown>>(account:T):T {
  const {referral_code:_retired,...current}=account;
  return current as T;
}
export function cleanAccounts(accounts:Account[]):Account[]{return accounts.map(withoutPersonalReferral);}
