import * as deviceStorage from '../platform/storage';
import type { Account } from './types';
import {playerLink} from './links';
const LEGACY_INVITER_KEY='game-platform.invited-by.v1';
export const CAMPAIGN_KEY='game-platform.experiment-campaign.v1';
export const INVITE_KEY='game-platform.invite-token.v1';
export const MATCH_KEY='game-platform.invite-match.v1';
type AttributionStorage=Pick<typeof deviceStorage,'getItem'|'setItem'|'removeItem'> & {exclusive?:typeof deviceStorage.exclusive};
export type MatchAttribution={invite_token?:string;invite_match_id?:string};
const campaignPattern=/^[a-z0-9][a-z0-9-]{0,49}$/;
const identifierPattern=/^[A-Za-z0-9_-]{1,128}$/;
const validIdentifier=(value:string|null):value is string=>!!value&&identifierPattern.test(value);
export const validCampaign=(value:unknown):value is string=>typeof value==='string'&&campaignPattern.test(value);
const knownCredential=(value:string,accounts:readonly Account[])=>accounts.some(account=>account.password===value);
function trustedUrl(raw:string,base:string):URL|null {
  try {const origin=new URL(base),url=new URL(raw,origin);if(url.username||url.password)return null;if(url.protocol==='buildplay:')return url;return ['https:','http:'].includes(url.protocol)&&url.origin===origin.origin?url:null;} catch{return null;}
}
export async function purgePersonalAttribution(storage:AttributionStorage=deviceStorage):Promise<void>{try{await storage.removeItem(LEGACY_INVITER_KEY);}catch{}}
export async function rememberUrlAttribution(raw:string,base:string,accounts:readonly Account[]=[],storage:AttributionStorage=deviceStorage):Promise<void> {
  await purgePersonalAttribution(storage);
  const url=trustedUrl(raw,base);if(!url)return;
  const hash=new URLSearchParams(url.hash.slice(1)),query=url.searchParams;
  const campaign=query.get('campaign')||hash.get('campaign');
  let target=playerLink(raw,base);
  if(!target||!['invite','match'].includes(target.kind)){
    const next=query.get('next'),nextUrl=next?trustedUrl(next,base):null;
    if(nextUrl)target=playerLink(nextUrl.href,base);
  }
  const remember=async()=>{
    const previousCampaign=await storage.getItem(CAMPAIGN_KEY);
    if(!validCampaign(previousCampaign)&&validCampaign(campaign)&&!knownCredential(campaign,accounts))await storage.setItem(CAMPAIGN_KEY,campaign);
    // Match links and invite codes identify one latest target, independent of
    // campaign attribution, and survive navigation until authentication.
    if(target&&(target.kind==='invite'||target.kind==='match')&&validIdentifier(target.id)&&!knownCredential(target.id,accounts)){
      await storage.removeItem(target.kind==='invite'?MATCH_KEY:INVITE_KEY);
      await storage.setItem(target.kind==='invite'?INVITE_KEY:MATCH_KEY,target.id);
    }
  };
  try {if(storage.exclusive)await storage.exclusive('url-attribution',remember);else await remember();}catch{/* Denied storage must not prevent login or opening a match. */}
}
export async function readCampaignCode(storage:AttributionStorage=deviceStorage):Promise<string|null> {try{const code=await storage.getItem(CAMPAIGN_KEY);return validCampaign(code)?code:null;}catch{return null;}}
export async function newAccountAttribution(accounts:readonly Account[]=[],storage:AttributionStorage=deviceStorage):Promise<MatchAttribution> {
  await purgePersonalAttribution(storage);
  try {const invite=await storage.getItem(INVITE_KEY),match=await storage.getItem(MATCH_KEY);if(validIdentifier(invite)&&!knownCredential(invite,accounts))return {invite_token:invite};return validIdentifier(match)&&!knownCredential(match,accounts)?{invite_match_id:match}:{};}catch{return {};}
}
export async function forgetMatchAttribution(storage:AttributionStorage=deviceStorage):Promise<void>{await Promise.all([purgePersonalAttribution(storage),storage.removeItem(INVITE_KEY).catch(()=>{}),storage.removeItem(MATCH_KEY).catch(()=>{})]);}
