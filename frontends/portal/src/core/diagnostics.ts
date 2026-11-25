/** An in-memory, bounded flight recorder. Never stores request bodies, headers,
 * typed form values, credentials, or full URLs with query/fragment secrets. */
type Entry = Record<string, unknown>;
const logs: Entry[] = [], apiCalls: Entry[] = [], events: Entry[] = [], pages: Entry[] = [];
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
function append(list: Entry[], entry: Entry, limit: number) {list.push(entry);if(list.length>limit)list.splice(0,list.length-limit);}
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
export function diagnosticSnapshot(context: Entry = {}) {
  const snapshot:Record<string,unknown>={version:1,sessionId,capturedAt:stamp(),context:clean(context),logs:logs.map(entry=>clean(entry)),apiCalls:apiCalls.map(entry=>clean(entry)),events:events.map(entry=>clean(entry)),pages:pages.map(entry=>clean(entry))};
  // Keep comfortably below the API limit even for multi-byte log messages.
  while(JSON.stringify(snapshot).length*3>160000) {
    const candidates=['logs','apiCalls','events','pages'].filter(key=>(snapshot[key] as Entry[]).length);
    if(!candidates.length){snapshot.context='[truncated]';break;}
    const longest=candidates.sort((a,b)=>(snapshot[b] as Entry[]).length-(snapshot[a] as Entry[]).length)[0];
    (snapshot[longest] as Entry[]).shift();
  }
  return snapshot;
}
