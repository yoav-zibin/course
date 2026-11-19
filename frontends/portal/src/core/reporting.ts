import {recordDiagnosticLog} from './diagnostics';
type Transport=(url:string,options:RequestInit)=>Promise<unknown>;
export function createReporter(base:string,passwords:()=>Iterable<string>,transport:Transport=fetch){
  const sent=new Set<string>();
  return (kind:string,error:unknown)=>{
    try{
      if(!/^[a-z][a-z0-9_]{0,31}$/.test(kind))return;
      let message=error instanceof Error?error.message:String(error??'');
      for(const value of passwords())if(value)message=message.split(value).join('<redacted>');
      message=message.replace(/\b(?:password|passwd|passcode|secret|token|authorization|api[_-]?key)\b["']?\s*[:=]\s*["']?[^\s,;&"'<>]+/gi,'<redacted>')
        .replace(/\bbearer\s+[^\s,;&"'<>]+/gi,'<redacted>')
        .replace(/https?:\/\/[^\s"'<>]+/g,value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return '<url>';}}).slice(0,500);
      const key=kind+':'+message;if(sent.has(key)||sent.size>=5)return;sent.add(key);
      const request=transport;
      void Promise.resolve().then(()=>request(base+'/client-errors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,message,page:'/portal'}),keepalive:true})).catch(()=>{});
    }catch{/* Error reporting must never interfere with gameplay. */}
  };
}
let report:(kind:string,error:unknown)=>void=()=>{};
export function configureReporter(next:typeof report){report=next;}
export function reportClientIssue(kind:string,error:unknown){recordDiagnosticLog('error',kind,error);report(kind,error);}
