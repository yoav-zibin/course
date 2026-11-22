import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import policy from '../src/platform/privacy-policy.json';
import copy from '../src/platform/ui-copy.json';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('the bundled privacy policy matches the canonical public policy and retains its links',()=>{
  execFileSync(process.execPath,[path.join(app,'scripts/sync-privacy-policy.mjs'),'--check']);
  const urls=policy.blocks.flatMap(block=>block.links?.map(link=>link.url)??[]);
  assert.deepEqual(urls,['https://buildplay.fun/','https://tools.google.com/dlpage/gaoptout','mailto:yoavgamingcoursezibin@gmail.com']);
  assert.ok(policy.blocks.some(block=>block.text.includes('Screenshots may show information visible in the app; review the preview before sending.')));
  assert.ok(policy.blocks.some(block=>block.text.includes('Invitation and recruitment history is kept permanently after account or match deletion.')));
});

test('the bundled privacy policy stays readable in every supported language without a network catalog',()=>{
  const dictionary=copy as Record<string,Record<string,string>>;
  for(const block of policy.blocks){
    const translations=dictionary[block.text];
    assert.ok(translations,block.text);
    const placeholders=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    for(const locale of ['es','fr','de','pt','zh','hi','ar']){
      assert.ok(translations[locale]?.trim(),`${block.text}:${locale}`);
      assert.deepEqual(placeholders(translations[locale]),placeholders(block.text),`${block.text}:${locale}`);
    }
  }
});
