import {copyFileSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Keep these versions aligned with site_pages.REPORTING_VERSION and the
// manual capture loader in static/site-bug-report.js.
const reportingAssets=[
  '/static/site-bug-report.js?v=3',
  '/static/site-bug-report.css?v=3',
  '/static/app/site-bug-capture.js?v=1',
];
const filesIn=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()
  ?filesIn(path.join(directory,item.name)):[path.join(directory,item.name)]);

/** Put the lazy capture bundle inside the shipped app artifact, and include
 * every reporter dependency in the service worker's revision and precache. */
export function preparePortalWebAssets({output,staticDirectory}){
  copyFileSync(path.join(staticDirectory,'app/site-bug-capture.js'),path.join(output,'site-bug-capture.js'));
  const files=filesIn(output).filter(file=>!file.endsWith('.map')&&path.basename(file)!=='worker.js').sort();
  const revision=createHash('sha256');
  for(const file of files)revision.update(path.relative(output,file)).update('\0').update(readFileSync(file));
  for(const url of reportingAssets){
    const source=path.join(staticDirectory,url.split('?')[0].slice('/static/'.length));
    revision.update(url).update('\0').update(readFileSync(source));
  }
  const assets=files.map(file=>'/static/app/'+path.relative(output,file).split(path.sep).join('/'))
    .filter(url=>url!=='/static/app/site-bug-capture.js');
  return {cache:'buildplay-shared-'+revision.digest('hex').slice(0,16),assets,versionedAssets:[...reportingAssets]};
}

export function renderPortalServiceWorker({cache,assets,versionedAssets}){
  return `
const CACHE=${JSON.stringify(cache)},ASSETS=${JSON.stringify(assets)},VERSIONED_ASSETS=${JSON.stringify(versionedAssets)};
const VERSIONED_PATHS=new Set(VERSIONED_ASSETS.map(value=>value.split('?')[0]));
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll([...ASSETS,...VERSIONED_ASSETS]);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if((key.startsWith('buildplay-shared-')||key.startsWith('playroom-portal-shell-'))&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==location.origin)return;const page=event.request.mode==='navigate'&&['/','/portal','/static/portal.html','/static/welcome.html','/static/app/','/static/app/index.html'].includes(url.pathname);if(page){event.respondWith(fetch(event.request,{cache:'no-cache'}).catch(()=>caches.open(CACHE).then(cache=>cache.match('/static/app/index.html'))));return;}let key;if(VERSIONED_PATHS.has(url.pathname)){key=url.pathname+url.search;if(!VERSIONED_ASSETS.includes(key))return;}else{key=url.pathname;if(!ASSETS.includes(key))return;}event.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(key);return saved||fetch(event.request);}));});
self.addEventListener('push',event=>{if(!event.data)return;let data;try{data=event.data.json();}catch{return;}event.waitUntil((async()=>{await self.registration.showNotification(data.title||'BuildPlay',{body:data.body||'',tag:data.tag,icon:'/static/portal-icon-192.png',data:{url:data.url||'/portal',user_id:data.user_id,notification_id:data.notification_id}});for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'buildplay-notification',...data});})());});
self.addEventListener('notificationclick',event=>{event.notification.close();let target;try{target=new URL(event.notification.data?.url||'/portal',location.origin);if(target.origin!==location.origin)target=new URL('/portal',location.origin);}catch{target=new URL('/portal',location.origin);}event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const client=clients.find(item=>new URL(item.url).origin===location.origin);return client?client.focus().then(()=>client.navigate(target.href)):self.clients.openWindow(target.href);}));});
`;
}
