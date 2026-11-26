import {cleanAccounts,withoutPersonalReferral} from '../core/account-data';
import type {Account} from '../core/types';

export const DEFAULT_API_ORIGIN='https://buildplay.fun';
interface Values {
  getItem(key:string):Promise<string|null>;
  setItem(key:string,value:string):Promise<void>;
}
export function apiOrigin(base=DEFAULT_API_ORIGIN):string {
  const url=new URL(base||DEFAULT_API_ORIGIN);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid API origin');
  return url.origin;
}
const encode=(value:string)=>Array.from(value).map(point=>point.codePointAt(0)!.toString(16)).join('-');
export function credentialKeys(base=DEFAULT_API_ORIGIN) {
  const origin=apiOrigin(base),scope=encodeURIComponent(origin);
  return {origin,accounts:`game-platform.accounts.v2.${scope}`,current:`game-platform.current-account.v2.${scope}`,
    password:(id:string)=>`buildplay.account.v2.${encode(origin)}.${encode(id)}`};
}
export function createCredentialVault(base:string|undefined,metadata:Values,secure:Values) {
  const keys=credentialKeys(base);
  return {
    keys,
    async loadAccounts():Promise<Account[]> {
      const text=await metadata.getItem(keys.accounts);
      const records=text?JSON.parse(text):[];
      if(!Array.isArray(records))throw new Error('Saved accounts need recovery');
      if(records.some(item=>item&&Object.hasOwn(item,'referral_code')))await metadata.setItem(keys.accounts,JSON.stringify(records.map(withoutPersonalReferral))).catch(()=>{});
      const accounts:Account[]=[];
      for(const item of records) {
        if(typeof item?.id!=='string'||!item.id)throw new Error('Saved accounts need recovery');
        const password=await secure.getItem(keys.password(item.id));
        if(password)accounts.push({...withoutPersonalReferral(item),password});
      }
      return accounts;
    },
    async saveAccounts(accounts:Account[]):Promise<void> {
      for(const account of accounts)await secure.setItem(keys.password(account.id),account.password);
      await metadata.setItem(keys.accounts,JSON.stringify(cleanAccounts(accounts).map(({password:_password,...item})=>item)));
    },
    async loadCurrentAccount():Promise<string|null> {
      return metadata.getItem(keys.current);
    },
  };
}
