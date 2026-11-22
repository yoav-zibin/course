import * as storage from '../platform/storage';
import {requestId} from './random-id';
export const VISITOR_KEY='game-platform.visitor.v1';
const validVisitor=(value:string|null):value is string=>!!value&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
let memoryVisitor:string|null=null,pending:Promise<string>|null=null;

/** A pseudonymous installation/browser ID, independent of account credentials. */
export function visitorId():Promise<string>{
  if(pending)return pending;
  const read=async()=>{try{
    const previous=await storage.getItem(VISITOR_KEY);if(validVisitor(previous))return previous;
    const value=requestId();await storage.setItem(VISITOR_KEY,value);return value;
  }catch{return memoryVisitor??=requestId();}};
  // API calls can happen inside a repository transaction. Use a separate lock
  // instead of nesting the repository's origin-wide storage lock.
  const locks=(globalThis.navigator as any)?.locks;
  const operation=locks?locks.request('buildplay-visitor-id',read):read();
  pending=Promise.resolve(operation).finally(()=>{pending=null;});return pending;
}
