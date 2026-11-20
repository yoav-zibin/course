import * as deviceStorage from '../platform/storage';
import type { Account } from './types';
import {playerLink} from './links';
export const INVITER_KEY='game-platform.invited-by.v1';
export const CAMPAIGN_KEY='game-platform.experiment-campaign.v1';
export const INVITE_KEY='game-platform.invite-token.v1';
type AttributionStorage=Pick<typeof deviceStorage,'getItem'|'setItem'|'removeItem'> & {exclusive?:typeof deviceStorage.exclusive};
const campaignPattern=/^[a-z0-9][a-z0-9-]{0,49}$/;
const identifierPattern=/^[A-Za-z0-9_-]{1,128}$/;
const validIdentifier=(value:string|null):value is string=>!!value&&identifierPattern.test(value);
export const validCampaign=(value:unknown):value is string=>typeof value==='string'&&campaignPattern.test(value);
const ownRef=(value:string,accounts:readonly Account[])=>accounts.some(account=>account.id===value||account.referral_code===value);
const knownCredential=(value:string,accounts:readonly Account[])=>accounts.some(account=>account.password===value);
function trustedUrl(raw:string,base:string):URL|null {
  try {const origin=new URL(base),url=new URL(raw,origin);if(url.username||url.password)return null;if(url.protocol==='buildplay:')return url;return ['https:','http:'].includes(url.protocol)&&url.origin===origin.origin?url:null;} catch{return null;}
}
export async function rememberUrlAttribution(raw:string,base:string,accounts:readonly Account[]=[],storage:AttributionStorage=deviceStorage):Promise<void> {
  const url=trustedUrl(raw,base);if(!url)return;
  const hash=new URLSearchParams(url.hash.slice(1)),query=url.searchParams;
  const ref=hash.get('ref')||query.get('ref'),campaign=query.get('campaign')||hash.get('campaign');
  const incoming=playerLink(raw,base);
  let invite=incoming?.kind==='invite'?incoming.id:hash.get('invite')||query.get('invite');
  if(!invite){const next=query.get('next');const target=next?trustedUrl(next,base):null;if(target){const link=playerLink(target.href,base);invite=link?.kind==='invite'?link.id:new URLSearchParams(target.hash.slice(1)).get('invite')||target.searchParams.get('invite');}}
  const remember=async()=>{
    let first=await storage.getItem(INVITER_KEY);
    if(first&&(!validIdentifier(first)||ownRef(first,accounts)||knownCredential(first,accounts))){await storage.removeItem(INVITER_KEY);first=null;}
    if(!first&&validIdentifier(ref)&&!ownRef(ref,accounts)&&!knownCredential(ref,accounts))await storage.setItem(INVITER_KEY,ref);
    const previousCampaign=await storage.getItem(CAMPAIGN_KEY);
    if(!validCampaign(previousCampaign)&&validCampaign(campaign)&&!knownCredential(campaign,accounts))await storage.setItem(CAMPAIGN_KEY,campaign);
    // Match tokens follow the currently opened invitation; the first ref and
    // campaign remain fixed while a visitor navigates or reloads.
    if(validIdentifier(invite)&&!knownCredential(invite,accounts))await storage.setItem(INVITE_KEY,invite);
  };
  try {if(storage.exclusive)await storage.exclusive('url-attribution',remember);else await remember();}catch{/* Denied storage must not prevent login or opening a match. */}
}
export async function readCampaignCode(storage:AttributionStorage=deviceStorage):Promise<string|null> {try{const code=await storage.getItem(CAMPAIGN_KEY);return validCampaign(code)?code:null;}catch{return null;}}
export async function newAccountAttribution(accounts:readonly Account[]=[],storage:AttributionStorage=deviceStorage):Promise<{invited_by_user_id?:string;invite_token?:string}> {
  try {const ref=await storage.getItem(INVITER_KEY),invite=await storage.getItem(INVITE_KEY);return {...(validIdentifier(ref)&&!ownRef(ref,accounts)&&!knownCredential(ref,accounts)?{invited_by_user_id:ref}:{}),...(validIdentifier(invite)&&!knownCredential(invite,accounts)?{invite_token:invite}:{})};}catch{return {};}
}
export async function forgetInviter(storage:AttributionStorage=deviceStorage):Promise<void>{await Promise.all([storage.removeItem(INVITER_KEY).catch(()=>{}),storage.removeItem(INVITE_KEY).catch(()=>{})]);}
