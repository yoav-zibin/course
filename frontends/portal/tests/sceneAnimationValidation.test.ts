import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneAnimations} from '../src/game/validation';
import type {GameSpec, Scene, SceneAnimation} from '../src/game/types';

const spec:GameSpec={format:'buildplay-ui',version:1,viewport:{width:600,height:600},
  boards:[{id:'board',kind:'grid',width:600,height:600,rows:3,columns:3},
    {id:'tray',kind:'zone',x:600,y:0,width:100,height:600}],
  piece_types:{token:{shape:'circle'}},ui_code:'const gameUI={reduce(){return {scene:{}}}};'};
const scene:Scene={pieces:[{id:'token',type:'token',board:'board',position:{cell:'0'},rotation:90}]};
const animation=():SceneAnimation=>({piece_id:'token',key:'turn:1',from:{rotation:0}});

test('scene animations accept explicit starting transforms and default positions on final piece boards',()=>{
  for(const from of [{rotation:-90},{scale:.2},{opacity:0},{position:{cell:'8'}},
    {position:{x:-50,y:100}},{board:'tray',position:{x:50,y:100},rotation:0,scale:2,opacity:.5}]){
    const entries=[{...animation(),from}];
    assert.equal(validateSceneAnimations(spec,scene,entries),entries);
  }
  assert.deepEqual(validateSceneAnimations(spec,scene,[]),[]);
  assert.deepEqual(validateSceneAnimations(spec,scene,undefined),[]);
  assert.doesNotThrow(()=>validateSceneAnimations(spec,scene,[{...animation(),duration_ms:5000,delay_ms:5000}]));
  const parallelScene={pieces:[...scene.pieces!,{...scene.pieces![0],id:'other'}]};
  assert.doesNotThrow(()=>validateSceneAnimations(spec,parallelScene,[animation(),{...animation(),piece_id:'other'}]));
});

test('scene animations reject malformed transforms, timing, identity and references',()=>{
  const invalid:unknown[]=[null,{},[null],[{}],[{...animation(),piece_id:'missing'}],
    [{...animation(),key:''}],[{...animation(),key:'bad key'}],[{...animation(),extra:true}],
    [animation(),animation()],Array(129).fill(animation())];
  for(const key of ['duration_ms','delay_ms'])for(const value of [-1,5001,1.5,true,NaN,Infinity])
    invalid.push([{...animation(),[key]:value}]);
  for(const from of [{},{board:'board'},{extra:0},{rotation:true},{rotation:100001},{rotation:-100001},
    {rotation:NaN},{rotation:Infinity},{scale:0},{scale:-1},{scale:101},{scale:true},
    {opacity:-.1},{opacity:1.1},{opacity:true},{board:'missing',position:{cell:'0'}},
    {position:{cell:'9'}},{position:{x:0}},{position:{cell:'0',x:0,y:0}}])
    invalid.push([{...animation(),from}]);
  for(const value of invalid)assert.throws(()=>validateSceneAnimations(spec,scene,value));
  assert.throws(()=>validateSceneAnimations(spec,{pieces:[{...scene.pieces![0],hidden:true}]},[animation()]));
});

test('explicit cell boards validate animation origins using the same cell vocabulary as final pieces',()=>{
  const named={...spec,boards:[{...spec.boards[0],cells:[{id:'named',x:100,y:100}]}]};
  const final={pieces:[{...scene.pieces![0],position:{cell:'named'}}]};
  assert.doesNotThrow(()=>validateSceneAnimations(named,final,[{...animation(),from:{position:{cell:'named'}}}]));
  assert.throws(()=>validateSceneAnimations(named,final,[{...animation(),from:{position:{cell:'0'}}}]));
});
