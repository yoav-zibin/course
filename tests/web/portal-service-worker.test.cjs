const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const vm=require('node:vm');

test('the web artifact carries capture code and revises its cache when any reporter dependency changes',async()=>{
  const {preparePortalWebAssets}=await import('../../tools/portal-web-assets.mjs');
  const directory=mkdtempSync(path.join(tmpdir(),'buildplay-worker-'));
  try{
    const output=path.join(directory,'export'),staticDirectory=path.join(directory,'static');
    mkdirSync(output);mkdirSync(path.join(staticDirectory,'app'),{recursive:true});
    writeFileSync(path.join(output,'index.html'),'<html><body>Public app shell</body></html>');
    writeFileSync(path.join(output,'index-abcd1234.js'),'console.log("public bundle");');
    writeFileSync(path.join(staticDirectory,'app/site-bug-capture.js'),'capture-v1');
    writeFileSync(path.join(staticDirectory,'site-bug-report.js'),'runtime-v1');
    writeFileSync(path.join(staticDirectory,'site-bug-report.css'),'styles-v1');
    const prepare=()=>preparePortalWebAssets({output,staticDirectory});
    let manifest=prepare();
    assert.equal(readFileSync(path.join(output,'site-bug-capture.js'),'utf8'),'capture-v1');
    assert.ok(manifest.versionedAssets.includes('/static/app/site-bug-capture.js?v=1'));
    assert.ok(manifest.versionedAssets.includes('/static/site-bug-report.js?v=2'));
    assert.ok(manifest.versionedAssets.includes('/static/site-bug-report.css?v=2'));
    assert.ok(manifest.assets.includes('/static/app/index-abcd1234.js'));
    for(const file of ['app/site-bug-capture.js','site-bug-report.js','site-bug-report.css']){
      writeFileSync(path.join(staticDirectory,file),`changed-${file}`);
      const next=prepare();assert.notEqual(next.cache,manifest.cache,file);manifest=next;
    }
    assert.equal(readFileSync(path.join(output,'site-bug-capture.js'),'utf8'),'changed-app/site-bug-capture.js');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('offline reporter assets match exact versions while admin documents and APIs stay on the network',async()=>{
  const {renderPortalServiceWorker}=await import('../../tools/portal-web-assets.mjs');
  const listeners={},saved=new Map(),precache=[];
  const assets=['/static/app/index.html','/static/app/_expo/static/js/web/index-abcd1234.js'];
  const versionedAssets=['/static/site-bug-report.js?v=2','/static/site-bug-report.css?v=2','/static/app/site-bug-capture.js?v=1'];
  const cache={async addAll(urls){for(const url of urls){precache.push(url);saved.set(url,{body:`cached:${url}`});}},async match(key){return saved.get(key);}};
  vm.runInNewContext(renderPortalServiceWorker({cache:'buildplay-shared-fixture',assets,versionedAssets}),{
    URL,location:{origin:'https://buildplay.test'},caches:{async open(){return cache;}},
    fetch:async()=>{throw new Error('offline');},
    self:{addEventListener(name,listener){listeners[name]=listener;},async skipWaiting(){},clients:{}},
  });
  let installed;listeners.install({waitUntil(value){installed=value;}});await installed;
  assert.deepEqual(precache,[...assets,...versionedAssets]);
  const request=async(url,{method='GET',mode='cors'}={})=>{
    let response;
    listeners.fetch({request:{url:new URL(url,'https://buildplay.test').href,method,mode},respondWith(value){response=Promise.resolve(value);}});
    return response===undefined?null:await response;
  };
  for(const url of versionedAssets)assert.equal((await request(url)).body,`cached:${url}`);
  for(const url of versionedAssets){
    assert.equal(await request(url.replace(/v=\d+$/,'v=0')),null);
    assert.equal(await request(url+'&cache-bust=other'),null);
    assert.equal(await request(url.split('?')[0]),null);
  }
  assert.equal((await request(assets[1]+'?existing-cache-bust=1')).body,`cached:${assets[1]}`);
  assert.equal((await request('/portal',{mode:'navigate'})).body,'cached:/static/app/index.html');
  for(const url of ['/admin','/admin/students','/static/admin.html','/admin/students/data','/admin/bug-reports','/auth/admin-session'])
    assert.equal(await request(url,{mode:'navigate'}),null,url);
  assert.equal(await request('/bug-reports',{method:'POST'}),null);
  assert.equal(await request('https://other.test/static/site-bug-report.js?v=2'),null);
});
