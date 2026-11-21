import {test,expect,type Page,type APIRequestContext} from '@playwright/test';

type Fault='none'|'cold-worker'|'cold-frame'|'never-ready';
const state=(move_count=0,hang=false)=>({type:'state_changed',status:'ongoing',move_count,
  my_player_index:0,acting_for_player_index:0,view:{hang}});
const code=`const started='Budget ready ';
const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;
  if(m.view?.hang){for(let i=0;i<30;i++)self.postMessage({type:'buildplay_worker_ready'});while(true){}}
  return {scene:{labels:[{id:'ready',x:20,y:30,text:started+m.move_count}]}};
}};`;

async function fault(page:Page,initial:Fault){
  await page.addInitScript(initial=>{
    if(window===window.top){
      (window as any).__executorFault=initial;
      const property=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc')!;
      Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...property,set(value:string){
        if(this.title==='Isolated game execution'){
          this.name=(window as any).__executorFault;
          // Delay only this disposable runtime's bootstrap, keeping its CSP and
          // all product timers unchanged. The old outer budget was3000ms.
          if(this.name==='cold-frame')value=value.replace('<script>',
            '<script>{const born=performance.now();while(performance.now()-born<3300){}}');
        }
        property.set!.call(this,value);
      }});
      return;
    }
    const mode=window.name;
    if(mode!=='cold-worker'&&mode!=='never-ready')return;
    const Original=window.Worker;
    window.Worker=class extends Original{
      constructor(url:string|URL,options?:WorkerOptions){
        // The delay occurs before the trusted worker handler is installed.
        // It is startup time, not work performed by a game reducer.
        const source=mode==='never-ready'?'self.onmessage=()=>{};':
          `const born=performance.now();while(performance.now()-born<1500){};importScripts(${JSON.stringify(String(url))});`;
        const wrapper=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        super(wrapper,options);URL.revokeObjectURL(wrapper);
      }
    };
  },initial);
}

async function mount(page:Page,request:APIRequestContext,baseURL?:string){
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Runtime faults require a disposable loopback server.');
  const pkg={format:'buildplay-ui',version:1,viewport:{width:400,height:300},
    boards:[{id:'board',kind:'grid',x:0,y:0,width:400,height:300,rows:1,columns:1}],
    piece_types:{token:{shape:'circle',width:40,height:40}},ui_code:code};
  const response=await request.post('/games/declarative/client',{data:pkg});expect(response.ok(),await response.text()).toBeTruthy();
  const document=(await response.json()).client_code;
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    (window as any).__runtimeReady=false;
    window.addEventListener('message',event=>{if(event.source===window&&event.data?.type==='game_ready')(window as any).__runtimeReady=true;});
  });
  await page.route('**/executor-fixture',route=>route.fulfill({contentType:'text/html',body:document}));
  await page.goto('/executor-fixture');await page.waitForFunction(()=>(window as any).__runtimeReady);
}
async function send(page:Page,count=0,hang=false){await page.evaluate(value=>window.postMessage(value,'*'),state(count,hang));}
async function cleaned(page:Page){
  await expect(page.locator('iframe[title="Isolated game execution"]')).toHaveCount(0);
  await expect.poll(()=>page.workers().length).toBe(0);
}

test('cold worker startup does not consume the healthy reducer execution budget',async({page,request,baseURL})=>{
  await fault(page,'cold-worker');await mount(page,request,baseURL);await send(page);
  await expect(page.getByText('Budget ready 0',{exact:true})).toBeVisible({timeout:7000});
  await expect(page.getByRole('alert')).toHaveCount(0);await cleaned(page);
});

test('a cold runtime iframe can start after the former three-second deadline',async({page,request,baseURL})=>{
  await fault(page,'cold-frame');await mount(page,request,baseURL);await send(page);
  await expect(page.getByText('Budget ready 0',{exact:true})).toBeVisible({timeout:8000});
  await expect(page.getByRole('alert')).toHaveCount(0);await cleaned(page);
});

test('a worker that never starts has a bounded startup failure and later healthy execution recovers',async({page,request,baseURL})=>{
  test.setTimeout(30000);
  await fault(page,'never-ready');await mount(page,request,baseURL);
  const before=Date.now();await send(page);
  await expect(page.getByRole('alert')).toContainText('Game runtime could not start within its time limit',{timeout:16000});
  expect(Date.now()-before).toBeGreaterThanOrEqual(9000);expect(Date.now()-before).toBeLessThan(18000);
  await cleaned(page);
  await page.evaluate(()=>{(window as any).__executorFault='none';});await send(page,1);
  await expect(page.getByText('Budget ready 1',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);await cleaned(page);
});

test('game readiness messages cannot restart the execution limit or prevent recovery',async({page,request,baseURL})=>{
  await fault(page,'none');await mount(page,request,baseURL);const before=Date.now();await send(page,0,true);
  await expect(page.getByRole('alert')).toContainText('Game execution exceeded its time limit',{timeout:5000});
  expect(Date.now()-before).toBeLessThan(4000);await cleaned(page);
  await send(page,1);await expect(page.getByText('Budget ready 1',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);await cleaned(page);
});
