import { MAX_SOURCE, MAX_RESULT } from './runtimeSource';

const workerSource = String.raw`
self.onmessage = ({data}) => {
  const reply = self.postMessage.bind(self);
  try {
    for (const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','setTimeout','setInterval','indexedDB','caches','BroadcastChannel']) {
      try { Object.defineProperty(self,name,{value:undefined,writable:false,configurable:false}); } catch {}
    }
    const result = (0,eval)(data);
    if (typeof result !== 'string' || new TextEncoder().encode(result).length > 900000) throw new Error('Game output exceeds its size limit');
    reply({ok:true,result});
  } catch (error) { reply({ok:false,error:String(error.message||error).slice(0,500)}); }
};`;

export function evaluate(source: string): Promise<string> {
  if (source.length > MAX_SOURCE) return Promise.reject(new Error('Game source exceeds its size limit'));
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Isolated game execution';
    frame.setAttribute('sandbox', 'allow-scripts');
    const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); window.removeEventListener('message', receive); frame.remove();
      error ? reject(error) : resolve(value!);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.ready) { frame.contentWindow!.postMessage({token, source}, '*'); return; }
      const result = event.data.result;
      if (!result || result.ok !== true) { finish(new Error(result?.error || 'Game execution failed')); return; }
      if (typeof result.result !== 'string' || result.result.length > MAX_RESULT) { finish(new Error('Game output exceeds its size limit')); return; }
      finish(undefined, result.result);
    };
    const timer = setTimeout(() => finish(new Error('Game execution exceeded its time limit')), 3000);
    window.addEventListener('message', receive);
    const bootstrap = `const token=${JSON.stringify(token)};const worker=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}],{type:'text/javascript'})));let timer;addEventListener('message',e=>{if(e.source!==parent||e.data?.token!==token)return;clearTimeout(timer);timer=setTimeout(()=>{worker.terminate();parent.postMessage({token,result:{ok:false,error:'Game execution exceeded its time limit'}},'*')},1200);worker.postMessage(e.data.source)});worker.onmessage=e=>{clearTimeout(timer);worker.terminate();parent.postMessage({token,result:e.data},'*')};worker.onerror=()=>parent.postMessage({token,result:{ok:false,error:'Game worker failed'}},'*');parent.postMessage({token,ready:true},'*');`;
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>${bootstrap.replace(/</g, '\\u003c')}</script>`;
    document.body.appendChild(frame);
  });
}
