import {diagnosticPath,diagnosticSnapshot,recordDiagnosticLog,redactDiagnostic} from './diagnostics';
type Transport=(url:string,options:RequestInit)=>Promise<unknown>;
type AutomaticContext={
  account:()=>{id:string;password:string}|null;
  context?:()=>Record<string,unknown>;
};
const unexpectedKinds=new Set(['script_error','unhandled_rejection','render_error','game_error','resource_error','unexpected_error']);
export function createReporter(base:string,passwords:()=>Iterable<string>,transport:Transport=fetch,automatic?:AutomaticContext){
  const sent=new Set<string>();
  return (kind:string,error:unknown)=>{
    try{
      if(!/^[a-z][a-z0-9_]{0,31}$/.test(kind))return;
      let message=error instanceof Error?error.message:String(error??'');
      for(const value of passwords())if(value)message=message.split(value).join('<redacted>');
      message=redactDiagnostic(message).slice(0,500);
      const key=kind+':'+message;if(sent.has(key)||sent.size>=5)return;sent.add(key);
      const request=transport;
      void Promise.resolve().then(()=>request(base+'/client-errors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,message,page:'/portal'}),keepalive:true})).catch(()=>{});
      if(automatic&&unexpectedKinds.has(kind)){
        const account=automatic.account();
        const headers:Record<string,string>={'Content-Type':'application/json'};
        if(account){headers['X-User-Id']=account.id;headers['X-User-Password']=account.password;}
        let stack=error instanceof Error?`${error.name}: ${error.message}\n${error.stack||''}`:String(error??'');
        for(const value of passwords())if(value)stack=stack.split(value).join('<redacted>');
        stack=redactDiagnostic(stack);
        const diagnostics={...diagnosticSnapshot(automatic.context?.()),automatic_error:{kind,message,stack,
          url:typeof location==='undefined'?'/portal':diagnosticPath(location.href)}};
        const body=JSON.stringify({automatic:true,text:`Automatic client error (${kind}): ${message}`,screenshot:null,diagnostics});
        // Diagnostic snapshots can exceed the browser's 64 KiB keepalive
        // budget, especially with several errors or non-ASCII log messages.
        void Promise.resolve().then(()=>request(base+'/bug-reports',{method:'POST',headers,body})).catch(()=>{});
      }
    }catch{/* Error reporting must never interfere with gameplay. */}
  };
}
let report:(kind:string,error:unknown)=>void=()=>{};
export function configureReporter(next:typeof report){report=next;}
export function reportClientIssue(kind:string,error:unknown){recordDiagnosticLog('error',kind,error);report(kind,error);}
