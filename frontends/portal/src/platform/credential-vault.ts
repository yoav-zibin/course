import type {Account} from '../core/types';

export const LEGACY_ACCOUNTS_KEY='game-platform.accounts.v1';
export const LEGACY_CURRENT_KEY='game-platform.current-account.v1';
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
const oldPasswordKey=(id:string)=>'buildplay.account.'+Array.from(id).map(point=>point.charCodeAt(0).toString(16)).join('-');

/** The former unscoped index belongs to production only. Migration copies into
 * origin-specific slots and never deletes the old index or secure passwords. */
export function createCredentialVault(base:string|undefined,metadata:Values,secure:Values) {
  const keys=credentialKeys(base);
  return {
    keys,
    async loadAccounts():Promise<Account[]> {
      const scoped=await metadata.getItem(keys.accounts);
      const legacy=scoped===null&&keys.origin===DEFAULT_API_ORIGIN;
      const text=scoped??(legacy?await metadata.getItem(LEGACY_ACCOUNTS_KEY):null);
      const records=text?JSON.parse(text):[];
      if(!Array.isArray(records))throw new Error('Saved accounts need recovery');
      const accounts:Account[]=[];
      for(const item of records) {
        if(typeof item?.id!=='string'||!item.id)throw new Error('Saved accounts need recovery');
        const password=await secure.getItem(legacy?oldPasswordKey(item.id):keys.password(item.id));
        if(password)accounts.push({...item,password});
      }
      return accounts;
    },
    async saveAccounts(accounts:Account[]):Promise<void> {
      for(const account of accounts)await secure.setItem(keys.password(account.id),account.password);
      await metadata.setItem(keys.accounts,JSON.stringify(accounts.map(({password:_password,...item})=>item)));
    },
    async loadCurrentAccount():Promise<string|null> {
      const current=await metadata.getItem(keys.current);
      return current??(keys.origin===DEFAULT_API_ORIGIN?metadata.getItem(LEGACY_CURRENT_KEY):null);
    },
  };
}
