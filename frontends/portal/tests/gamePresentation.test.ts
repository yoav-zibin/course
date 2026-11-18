import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {canonical,reviewedPresentation} from '../src/game/presentationCore';
import replacement from '../src/game/reviewedBackgammon.json';

const root=resolve(import.meta.dirname,'../../..');
const read=(name:string)=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
const digest=async(source:string)=>createHash('sha256').update(source).digest('hex');
const game=()=>({id:'5f5293c3-2a3a-4eec-b631-9debf59be0ca',version:1,
  server_code:readFileSync(resolve(root,'games/declarative/backgammon.server.js'),'utf8'),
  declarative_ui:read('tests/fixtures/declarative/backgammon-v1-ui.json')});

test('exact reviewed historical Backgammon UIs receive bundled repair while rules and version remain pinned',async()=>{
  for(const version of [1,2,3]){
    const input={...game(),version,declarative_ui:read(`tests/fixtures/declarative/backgammon-v${version}-ui.json`)};
    const before=JSON.stringify(input),result=await reviewedPresentation(input,digest);
    assert.deepEqual(result,replacement);assert.notEqual(result,replacement);assert.equal(JSON.stringify(input),before);
  }
});
test('presentation repair is scoped by game identity, authoritative rule hash and complete authored UI bytes',async()=>{
  for(const change of [(g:ReturnType<typeof game>)=>{g.id='another';},(g:ReturnType<typeof game>)=>{g.server_code+='\n// changed rules';},
    (g:ReturnType<typeof game>)=>{g.declarative_ui.viewport.width+=1;},(g:ReturnType<typeof game>)=>{g.declarative_ui.ui_code+='\n// changed source';}]){
    const input=game();change(input);assert.equal(await reviewedPresentation(input,digest),input.declarative_ui);
  }
});
test('bundled repair hash, independent result copies and fail-safe cryptography behavior remain stable',async()=>{
  assert.equal(await digest(canonical(replacement)),'34094a02eb9678b6ce612034f4ccd407eb02b577081e8cda9ec9634a8a1a3c24');
  const input=game(),first=await reviewedPresentation(input,digest),second=await reviewedPresentation(input,digest);
  assert.notEqual(first,second);assert.deepEqual(first,second);
  assert.equal(await reviewedPresentation(input,async()=>{throw new Error('unavailable');}),input.declarative_ui);
  assert.equal(await reviewedPresentation(null,digest),undefined);
  assert.equal(canonical({'9':'nine','10':'ten'}),'{"10":"ten","9":"nine"}');
});
