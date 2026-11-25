/** An in-memory, bounded flight recorder. Never stores request bodies, headers,
 * typed form values, credentials, or full URLs with query/fragment secrets. */
import {utf8Size} from '../platform/recoverable-cache';

type Entry = Record<string, unknown>;
const MAX_DIAGNOSTIC_BYTES = 100_000;
const logs: Entry[] = [], apiCalls: Entry[] = [], events: Entry[] = [], pages: Entry[] = [];
const entryOrder=new WeakMap<Entry,number>();
let nextEntry=0;
const secrets = new Set<string>();
const newSessionId = () => `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
let sessionId = newSessionId(), scope: string | null = null;
export const diagnosticSessionId = () => sessionId;
/** A report belongs to the current account and API origin. Keep knowledge of
 * old credentials for redaction, but never include another account's activity. */
export function setDiagnosticScope(next: string) {
  if (next === scope) return;
  scope = next; sessionId = newSessionId();
  for (const entries of [logs, apiCalls, events, pages]) entries.length = 0;
}
const stamp = () => new Date().toISOString();
function append(list: Entry[], entry: Entry, limit: number) {
  entryOrder.set(entry,++nextEntry);
  list.push(entry);if(list.length>limit)list.splice(0,list.length-limit);
}
export function rememberDiagnosticSecrets(values: Iterable<string>) {for(const value of values)if(value)secrets.add(value);}
export function diagnosticPath(raw: string) {
  try {
    const url=new URL(raw,'https://buildplay.invalid');
    return url.pathname.replace(/(\/(?:invites|app-sessions)\/)\S+/g,'$1[redacted]');
  } catch {return '[invalid URL]';}
}
export function redactDiagnostic(value: unknown): string {
  let result: string;
  try {result=value instanceof Error?`${value.name}: ${value.message}\n${value.stack||''}`:typeof value==='string'?value:JSON.stringify(value, (key, child)=>/password|passwd|secret|token|authorization|cookie|credential|api[_-]?key/i.test(key)?'[redacted]':child)??String(value);} catch {result='[unserializable]';}
  for(const secret of secrets)result=result.split(secret).join('[redacted]');
  return result.replace(/\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+[^\s,;\"'<>]+/gi,'Authorization: [redacted]')
    .replace(/\b(?:password|passwd|passcode|secret|(?:access[_-]|refresh[_-]|id[_-])?token|authorization|cookie|code|api[_-]?key)\b["']?\s*[:=]\s*(["'])(.*?)\1/gi,'[redacted]')
    .replace(/\b(?:password|passwd|passcode|secret|token|authorization|cookie|code|api[_-]?key)\b["']?\s*[:=]\s*["']?[^\s,;&"'<>]+/gi,'[redacted]')
    .replace(/\bbearer\s+[^\s,;&"'<>]+/gi,'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,'[redacted token]')
    .replace(/https?:\/\/[^\s"'<>]+/g,raw=>{try {const url=new URL(raw);return url.origin+diagnosticPath(raw);}catch{return '[URL]';}})
    .slice(0,1000);
}
function clean(value:unknown,depth=0,budget={remaining:18000}):unknown {
  if(budget.remaining<=0)return '[truncated]';
  if(depth>5)return '[nested]';
  if(typeof value==='string'||value instanceof Error){const result=redactDiagnostic(value).slice(0,budget.remaining);budget.remaining-=result.length;return result;}
  if(Array.isArray(value)){const result:unknown[]=[];for(const child of value.slice(0,35)){if(budget.remaining<=0)break;result.push(clean(child,depth+1,budget));}return result;}
  if(value&&typeof value==='object'){const result:Entry={};for(const [key,child] of Object.entries(value).slice(0,35)){if(budget.remaining<=0)break;budget.remaining-=key.length;result[key]=/password|passwd|secret|token|authorization|cookie|credential|api[_-]?key/i.test(key)?'[redacted]':clean(child,depth+1,budget);}return result;}
  return value;
}
export function recordDiagnosticLog(level: string, ...values: unknown[]) {append(logs,{at:stamp(),level,message:values.map(redactDiagnostic).join(' ').slice(0,1400)},100);}
export function recordDiagnosticEvent(name: string, metadata?: Entry) {append(events,{at:stamp(),name, ...(metadata?{metadata:clean(metadata)}: {})},70);}
export function recordDiagnosticPage(page: Entry) {
  const safe=clean(page);
  if(JSON.stringify(pages[pages.length-1]?.page)===JSON.stringify(safe))return;
  append(pages,{at:stamp(),page:safe},30);
}
export function startDiagnosticRequest(method:string,path:string,metadata:Entry={}) {
  const start=Date.now(), entry:Entry={at:stamp(),method,path:diagnosticPath(path),...(clean(metadata) as Entry),state:'pending'};
  append(apiCalls,entry,70);
  return (status:number|null,details:Entry={})=>{Object.assign(entry,{status,durationMs:Date.now()-start,state:status===null?'failed':'complete'},clean(details));};
}
export function diagnosticSnapshot(context: Entry = {}, automaticError?: Entry) {
  const snapshot={
    version:1,sessionId,capturedAt:stamp(),context:clean(context),
    ...(automaticError?{automatic_error:clean(automaticError)}:{}),
    logs:[] as unknown[],apiCalls:[] as unknown[],events:[] as unknown[],pages:[] as unknown[],
  };
  let bytes=utf8Size(JSON.stringify(snapshot));
  if(bytes>MAX_DIAGNOSTIC_BYTES){
    snapshot.context='[truncated]';
    bytes=utf8Size(JSON.stringify(snapshot));
  }
  const historyBudget=MAX_DIAGNOSTIC_BYTES-bytes;
  const histories=[
    {source:logs,target:snapshot.logs},{source:apiCalls,target:snapshot.apiCalls},
    {source:events,target:snapshot.events},{source:pages,target:snapshot.pages},
  ].map(list=>({...list,next:list.source.length-1}));
  // Walk the newest tails together, keeping chronological order within a list.
  for(;;){
    let newest:(typeof histories)[number]|undefined,order=0;
    for(const list of histories){
      if(list.next<0)continue;
      const candidate=entryOrder.get(list.source[list.next])??0;
      if(candidate>order){newest=list;order=candidate;}
    }
    if(!newest)break;
    const entry=clean(newest.source[newest.next--]);
    const entryBytes=utf8Size(JSON.stringify(entry));
    if(entryBytes>historyBudget)continue;
    const cost=entryBytes+(newest.target.length?1:0);
    if(bytes+cost>MAX_DIAGNOSTIC_BYTES)break;
    newest.target.unshift(entry);
    bytes+=cost;
  }
  return snapshot;
}
