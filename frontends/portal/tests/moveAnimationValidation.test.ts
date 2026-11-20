import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateMoveAnimations} from '../src/game/validation';
import type {GameSpec, MoveAnimation, Scene} from '../src/game/types';

const spec:GameSpec={format:'buildplay-ui',version:1,viewport:{width:600,height:600},
  boards:[{id:'board',kind:'grid',width:600,height:600,rows:3,columns:3},
    {id:'tray',kind:'zone',x:600,y:0,width:100,height:600}],
  piece_types:{token:{shape:'circle'}},ui_code:'const gameUI={reduce(){return {scene:{}}}};'};
const scene:Scene={pieces:[{id:'token',type:'token',board:'tray',position:{x:50,y:100}}]};
const paths=():MoveAnimation[]=>[
  {piece_id:'token',path:[{board:'board',position:{cell:'0'}},{board:'board',position:{cell:'1'}}]},
  {piece_id:'token',path:[{board:'board',position:{x:300,y:100}},{board:'tray',position:{x:50,y:100}}]},
];

test('ordered paths validate board-relative positions, continuity and the final scene',()=>{
  const animations=paths();
  assert.equal(validateMoveAnimations(spec,scene,animations),animations);
  assert.equal(validateMoveAnimations(spec,scene,null),null);
  assert.equal(validateMoveAnimations(spec,scene,undefined),null);
  assert.deepEqual(validateMoveAnimations(spec,scene,[]),[]);
});

test('paths reject unknown references, hidden pieces, discontinuities and wrong final positions',()=>{
  const invalid:unknown[]=[{},[{}],paths().map(p=>({...p,piece_id:'missing'})),
    [{piece_id:'token',path:[{board:'missing',position:{cell:'0'}},{board:'tray',position:{x:50,y:100}}]}],
    [{piece_id:'token',path:[{board:'board',position:{cell:'9'}},{board:'tray',position:{x:50,y:100}}]}],
    [{piece_id:'token',path:[{board:'board',position:{x:NaN,y:100}},{board:'tray',position:{x:50,y:100}}]}],
    [{...paths()[0],path:[paths()[0].path[0]]}],
    [{...paths()[0],duration_ms:-1}], [{...paths()[0],duration_ms:5001}],
    [{...paths()[0],duration_ms:1.5}], [{...paths()[0],extra:true}],
  ];
  for(const value of invalid)assert.throws(()=>validateMoveAnimations(spec,scene,value));
  const broken=paths();broken[1].path[0].position={x:301,y:100};
  assert.throws(()=>validateMoveAnimations(spec,scene,broken));
  const wrongEnd=paths();wrongEnd[1].path[1].position={x:51,y:100};
  assert.throws(()=>validateMoveAnimations(spec,scene,wrongEnd));
  const hidden={pieces:scene.pieces!.map(piece=>({...piece,hidden:true}))};
  assert.throws(()=>validateMoveAnimations(spec,hidden,paths()));
});

test('paths bound sequence size, path size and cumulative duration including defaults',()=>{
  const loop:MoveAnimation={piece_id:'token',path:[{board:'tray',position:{x:50,y:100}},{board:'tray',position:{x:50,y:100}}]};
  assert.throws(()=>validateMoveAnimations(spec,scene,Array(21).fill(loop)));
  assert.doesNotThrow(()=>validateMoveAnimations({...spec,motion:{move_ms:1000}},scene,Array(30).fill(loop)));
  assert.throws(()=>validateMoveAnimations({...spec,motion:{move_ms:1000}},scene,Array(31).fill(loop)));
  assert.throws(()=>validateMoveAnimations(spec,scene,Array(129).fill({...loop,duration_ms:0})));
  assert.throws(()=>validateMoveAnimations(spec,scene,[{...loop,path:Array(65).fill(loop.path[0])}]));
});
