import { MAX_SOURCE, MAX_RESULT } from './runtimeSource';

const STARTUP_TIMEOUT = 10_000;
const EXECUTION_TIMEOUT = 1_200;
const EXECUTION_WATCHDOG = 3_000;
const WORKER_READY = 'buildplay_worker_ready';
const STARTUP_ERROR = 'Game runtime could not start within its time limit';
const EXECUTION_ERROR = 'Game execution exceeded its time limit';

const workerSource = String.raw`
(() => {
let started = false;
self.onmessage = ({data}) => {
  if (started) return;
  started = true;
  const reply = self.postMessage.bind(self);
  try {
    for (const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','setTimeout','setInterval','indexedDB','caches','BroadcastChannel']) {
      try { Object.defineProperty(self,name,{value:undefined,writable:false,configurable:false}); } catch {}
    }
    const result = (0,eval)(data);
    if (typeof result !== 'string' || new TextEncoder().encode(result).length > 900000) throw new Error('Game output exceeds its size limit');
    reply({ok:true,result});
  } catch (error) { reply({ok:false,error:String(error.message||error).slice(0,500)}); }
};
self.postMessage({type:${JSON.stringify(WORKER_READY)}});
})();`;

export function evaluate(source: string): Promise<string> {
  if (source.length > MAX_SOURCE) return Promise.reject(new Error('Game source exceeds its size limit'));
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Isolated game execution';
    frame.setAttribute('sandbox', 'allow-scripts');
    const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
    let phase: 'starting' | 'running' | 'finished' = 'starting';
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, value?: string) => {
      if (phase === 'finished') return;
      phase = 'finished';
      clearTimeout(timer); window.removeEventListener('message', receive); frame.remove();
      error ? reject(error) : resolve(value!);
    };
    const receive = (event: MessageEvent) => {
      if (phase === 'finished' || event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.ready === true) {
        if (phase !== 'starting') return;
        phase = 'running';
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error(EXECUTION_ERROR)), EXECUTION_WATCHDOG);
        try { frame.contentWindow!.postMessage({token, source}, '*'); }
        catch { finish(new Error('Game worker failed')); }
        return;
      }
      const result = event.data.result;
      if (!result || result.ok !== true) { finish(new Error(result?.error || 'Game execution failed')); return; }
      if (phase !== 'running') { finish(new Error('Game worker failed')); return; }
      if (typeof result.result !== 'string' || result.result.length > MAX_RESULT) { finish(new Error('Game output exceeds its size limit')); return; }
      finish(undefined, result.result);
    };
    // A cold iframe or worker can take longer to start than the game is allowed
    // to execute. Its bounded startup never consumes or extends the game budget.
    timer = setTimeout(() => finish(new Error(STARTUP_ERROR)), STARTUP_TIMEOUT);
    window.addEventListener('message', receive);
    const bootstrap = `
const token=${JSON.stringify(token)};
let phase='boot',worker,url,timer;
const cleanup=()=>{
  phase='finished';clearTimeout(timer);removeEventListener('message',receive);
  removeEventListener('pagehide',cleanup);removeEventListener('unload',cleanup);
  if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();worker=undefined;}
  if(url){URL.revokeObjectURL(url);url=undefined;}
};
const finish=result=>{
  if(phase==='finished')return;
  cleanup();
  parent.postMessage({token,result},'*');
};
const receive=e=>{
  if(e.source!==parent||e.data?.token!==token||phase!=='ready')return;
  if(typeof e.data.source!=='string'){finish({ok:false,error:'Game worker failed'});return;}
  phase='running';clearTimeout(timer);
  timer=setTimeout(()=>finish({ok:false,error:${JSON.stringify(EXECUTION_ERROR)}}),${EXECUTION_TIMEOUT});
  try{worker.postMessage(e.data.source);}catch{finish({ok:false,error:'Game worker failed'});}
};
addEventListener('message',receive);
addEventListener('pagehide',cleanup);addEventListener('unload',cleanup);
timer=setTimeout(()=>finish({ok:false,error:${JSON.stringify(STARTUP_ERROR)}}),${STARTUP_TIMEOUT});
try{
  url=URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}],{type:'text/javascript'}));
  worker=new Worker(url);
  worker.onmessage=e=>{
    if(e.data?.type===${JSON.stringify(WORKER_READY)}){
      if(phase!=='boot')return;
      phase='ready';parent.postMessage({token,ready:true},'*');return;
    }
    if(phase==='running')finish(e.data);
    else finish({ok:false,error:'Game worker failed'});
  };
  worker.onerror=()=>finish({ok:false,error:'Game worker failed'});
  worker.onmessageerror=()=>finish({ok:false,error:'Game worker failed'});
}catch{finish({ok:false,error:'Game worker failed'});}`;
    try {
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>${bootstrap.replace(/</g, '\\u003c')}</script>`;
      document.body.appendChild(frame);
    } catch { finish(new Error('Game worker failed')); }
  });
}
