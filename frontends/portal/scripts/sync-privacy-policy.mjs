#!/usr/bin/env node
// The public HTML policy remains authoritative. Native and web dialogs bundle
// this generated, text-only representation so the policy also works offline.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(app,'../../static/privacy.html');
const destination=path.join(app,'src/platform/privacy-policy.json');
const kinds={h1:'title',h2:'heading',p:'paragraph',li:'bullet',footer:'footer'};
const decode=value=>value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi,entity=>{
  const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
  if(named[entity.toLowerCase()])return named[entity.toLowerCase()];
  return String.fromCodePoint(parseInt(entity.slice(entity[2].toLowerCase()==='x'?3:2,-1),entity[2].toLowerCase()==='x'?16:10));
});
const plain=value=>decode(value.replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim();
const html=readFileSync(source,'utf8');
const body=html.split(/<body\b[^>]*>/i)[1]?.split(/<\/body>/i)[0];
if(!body)throw new Error('The canonical privacy policy has no body.');
const blocks=[];
for(const match of body.matchAll(/<(h1|h2|p|li|footer)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
  const links=[];
  const content=match[2].replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,(_all,url,label)=>{
    const placeholder=`link${links.length}`;
    links.push({placeholder,label:plain(label),url:decode(url)});
    return `{${placeholder}}`;
  });
  const text=plain(content);
  if(text)blocks.push({kind:kinds[match[1].toLowerCase()],text,...(links.length?{links}:{})});
}
if(blocks.filter(block=>block.kind==='title').length!==1)throw new Error('The privacy policy needs one title.');
const result=JSON.stringify({source:'static/privacy.html',blocks},null,2)+'\n';
if(process.argv.includes('--check')){
  if(readFileSync(destination,'utf8')!==result)throw new Error('Privacy dialog content is stale. Run node frontends/portal/scripts/sync-privacy-policy.mjs.');
}else writeFileSync(destination,result);
