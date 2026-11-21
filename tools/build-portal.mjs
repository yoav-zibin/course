#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePortalWebAssets,renderPortalServiceWorker} from './portal-web-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await import('./build-site-bug-capture.mjs');
const app=path.join(root,'frontends/portal'),destination=path.join(root,'static/app');
const out=path.join(app,'.expo',`web-build-${process.pid}`);
const build=spawnSync(process.execPath,[path.join(app,'node_modules/expo/bin/cli'),'export','--platform','web','--output-dir',out],{cwd:app,stdio:'inherit',env:{...process.env,CI:'1'}});
if(build.status!==0)process.exit(build.status||1);
let html=readFileSync(path.join(out,'index.html'),'utf8');
html=html.replace('</head>','<meta name="theme-color" content="#10141f"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="manifest" href="/static/app/manifest.webmanifest"><link rel="apple-touch-icon" href="/static/portal-icon-180.png"></head>');
writeFileSync(path.join(out,'index.html'),html);
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]);
const styles=[...html.matchAll(/<link[^>]+href="([^"]+\.css[^\"]*)"/g)].map(match=>match[1]);
if(!scripts.length||scripts.some(url=>!url.startsWith('/static/app/')))throw new Error('Web export must use /static/app for all entry scripts');
writeFileSync(path.join(out,'entry.json'),JSON.stringify({scripts,styles}));
writeFileSync(path.join(out,'compat.js'),`(async()=>{try{const entry=${JSON.stringify({scripts,styles})};for(const href of entry.styles){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);}for(const src of entry.scripts){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.body.appendChild(script);});}}catch(error){document.getElementById('root').textContent='The shared game renderer could not load. Refresh while connected.';}})();`);
writeFileSync(path.join(out,'manifest.webmanifest'),JSON.stringify({id:'/static/portal.html',name:'BuildPlay',short_name:'BuildPlay',start_url:'/portal',scope:'/',display:'standalone',background_color:'#10141f',theme_color:'#10141f',icons:[{src:'/static/portal-icon-192.png',sizes:'192x192',type:'image/png'},{src:'/static/portal-icon-512.png',sizes:'512x512',type:'image/png'}]}));
const gitRevision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
writeFileSync(path.join(out,'version.json'),JSON.stringify({version:'2.0.0',commit:process.env.GITHUB_SHA||gitRevision.stdout.trim()}));
const walk=(directory)=>readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(directory,item.name)):[path.join(directory,item.name)]);
const {cache,assets,versionedAssets}=preparePortalWebAssets({output:out,staticDirectory:path.join(root,'static')});
writeFileSync(path.join(out,'worker.js'),renderPortalServiceWorker({cache,assets,versionedAssets}));
console.log(`Shared portal exported: ${assets.length+versionedAssets.length} files, cache ${cache}`);
// Publish entry files only after every hashed asset exists. Existing pages and
// tests can finish loading an earlier bundle while a local rebuild is running.
mkdirSync(destination,{recursive:true});
const entries=new Set(['index.html','entry.json','compat.js','manifest.webmanifest','worker.js','version.json']);
const outputFiles=walk(out);
for(const file of outputFiles.filter(file=>!entries.has(path.relative(out,file)))){
  const target=path.join(destination,path.relative(out,file));mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,readFileSync(file));
}
for(const name of ['entry.json','compat.js','manifest.webmanifest','version.json','worker.js','index.html']){
  const temporary=path.join(destination,`.${name}.${process.pid}`);writeFileSync(temporary,readFileSync(path.join(out,name)));renameSync(temporary,path.join(destination,name));
}
rmSync(out,{recursive:true,force:true});
