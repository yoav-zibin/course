const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function worker() {
  const handlers = {};
  const context = vm.createContext({self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn},URL});
  vm.runInContext(read('static/portal-sw.js'), context);
  return {context,handlers,shell:Array.from(vm.runInContext('SHELL',context))};
}
test('every page script, style, manifest and install icon is precached at its exact URL',()=>{
  const {shell} = worker();
  const assets = [...read('static/portal.html').matchAll(/<(?:script|link|img)\b[^>]*?\s(?:src|href)="(\/static\/[^"#]+)"/g)].map(m=>m[1]);
  for(const asset of assets) assert.ok(shell.includes(asset), `missing ${asset}`);
  for(const asset of shell) assert.ok(fs.existsSync(path.join(root, asset.split('?')[0])), asset);
  const manifest=JSON.parse(read('static/portal.webmanifest'));
  assert.equal(manifest.start_url, '/static/portal.html');
  for(const size of [192,512]) {
    const icon=manifest.icons.find(i=>i.sizes===`${size}x${size}` && i.type==='image/png');
    assert.ok(icon);assert.ok(shell.includes(icon.src));
    const png=fs.readFileSync(path.join(root,icon.src));
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
});
test('worker serves saved shell offline and leaves APIs and other students pages untouched',async()=>{
  const {context,handlers}=worker();
  const saved={body:'cached'};
  context.caches={open:async()=>({match:async()=>saved})};
  context.fetch=()=>{throw Error('offline')};
  let response;
  handlers.fetch({request:{method:'GET',url:'https://example.test/static/portal.html'},respondWith:p=>response=p});
  assert.equal(await response,saved);
  for(const [method,url] of [['GET','/matches'],['GET','/static/admin.html'],['POST','/matches/m/moves']]) {
    handlers.fetch({request:{method,url:'https://example.test'+url},respondWith(){assert.fail('request intercepted')}});
  }
});
test('game detail pages (portal.html?game=<id>) open from the saved portal offline',async()=>{
  // Regression (bug 14): game pages moved to ?game=<id>, a URL the shell list doesn't name.
  const {context,handlers}=worker();
  const saved={body:'cached'};
  const asked=[];
  context.caches={open:async()=>({match:async key=>{asked.push(key);return saved;}})};
  context.fetch=()=>{throw Error('offline')};
  let response;
  handlers.fetch({request:{method:'GET',url:'https://example.test/static/portal.html?game=g1&skin=party'},respondWith:p=>response=p});
  assert.ok(response,'the worker answers the game page');
  assert.equal(await response,saved);
  assert.deepEqual(asked,['/static/portal.html']);
});
test('worker returns successful network responses when cache writes or opening fail',async()=>{
  const {context,handlers}=worker();
  context.console={warn(){}};
  const network={ok:true,clone(){return this;}};
  context.fetch=async()=>network;
  context.caches={open:async()=>({match:async()=>undefined,keys:async()=>[],put:async()=>{throw Error('quota');}})};
  for(const url of ['/static/portal.html','/static/avatars/computers/example.png']) {
    let response;
    handlers.fetch({request:{method:'GET',url:'https://example.test'+url},respondWith:p=>response=p});
    assert.equal(await response,network);
  }
  context.caches.open=async()=>{throw Error('unavailable')};
  let response;
  handlers.fetch({request:{method:'GET',url:'https://example.test/static/portal.html'},respondWith:p=>response=p});
  assert.equal(await response,network);
});
test('worker activation signals portal reload without awaiting navigation',async()=>{
  const {context,handlers}=worker();
  const messages=[], deleted=[];
  context.caches={keys:async()=>['playroom-portal-shell-v1'],delete:async key=>deleted.push(key)};
  context.self.clients={claim:async()=>{},matchAll:async()=>[
    {url:'https://example.test/static/portal.html',postMessage:message=>messages.push(message.type)},
    {url:'https://example.test/static/admin.html',postMessage:()=>assert.fail('wrong page')}
  ]};
  let activation;
  handlers.activate({waitUntil:promise=>activation=promise});
  await activation;
  assert.deepEqual(deleted,['playroom-portal-shell-v1']);
  assert.deepEqual(messages,['portal-shell-updated']);
});
function install(standalone=false) {
  const events={},nodes={};
  for(const id of ['install-portal','install-help','install-message']) nodes[id]={hidden:id==='install-portal',addEventListener:(event,fn)=>events[id+event]=fn};
  vm.runInNewContext(read('static/portal-install.js'),{I18n:require('./i18n-stub.cjs'),document:{getElementById:id=>nodes[id]},navigator:{},window:{matchMedia:()=>({matches:standalone}),addEventListener:(event,fn)=>events[event]=fn}});
  return {events,nodes};
}
test('worker install completes when one shell asset fails to cache', async () => {
  const { context, handlers, shell } = worker();
  const added = [];
  let skipped = false;
  context.caches = { open: async () => ({ add: async (url) => { if (url.includes('portal.js')) throw Error('flaky'); added.push(url); } }) };
  context.self.skipWaiting = async () => { skipped = true; };
  context.console = { warn() {} };
  let installation;
  handlers.install({ waitUntil: (promise) => { installation = promise; } });
  await installation;
  assert.equal(skipped, true);
  assert.equal(added.length, shell.length - 1);
  assert.ok(!added.some((url) => url.includes('portal.js')));
});
test('install prompt requires a click, handles dismissal, and accepts a later prompt',async()=>{
  const {events,nodes}=install();let calls=0,prevented=false;
  const prompt={preventDefault(){prevented=true},prompt:async()=>calls++,userChoice:Promise.resolve({outcome:'dismissed'})};
  events.beforeinstallprompt(prompt);assert.ok(prevented);assert.equal(calls,0);assert.equal(nodes['install-portal'].hidden,false);
  await events['install-portalclick']();assert.equal(calls,1);assert.equal(nodes['install-portal'].hidden,true);
  assert.match(nodes['install-message'].textContent,/later/);
  events.beforeinstallprompt(prompt);assert.equal(nodes['install-portal'].hidden,false);
  events.appinstalled();assert.equal(nodes['install-help'].hidden,true);
});
test('standalone apps hide installation help and prompt failure leaves manual instructions',async()=>{
  assert.equal(install(true).nodes['install-help'].hidden,true);
  const {events,nodes}=install();
  events.beforeinstallprompt({preventDefault(){},prompt:async()=>{throw Error('unavailable')}});
  await events['install-portalclick']();assert.match(nodes['install-message'].textContent,/browser/);assert.equal(nodes['install-portal'].disabled,false);
});
test('the portal asks for worker updates itself, never from a cached worker script',()=>{
  const portal=read('static/portal.js');
  // A cached copy of the worker script must never answer an update check,
  // and the page checks on load and on every return to the tab instead of
  // waiting for the browser's own throttled schedule.
  assert.match(portal,/register\("\/static\/portal-sw\.js", \{ updateViaCache: "none" \}\)/);
  assert.match(portal,/registration\.update\(\)/);
  assert.match(portal,/visibilitychange/);
});
