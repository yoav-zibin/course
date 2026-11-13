const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

// console.js loads with common.js on the page; the few common.js helpers it
// uses are inlined here verbatim so the test exercises console.js itself.
const COMMON_DEFS=`
function shortId(id) { return id.length > 8 ? id.slice(0, 8) : id; }
async function fetchAdminCollection(kind) {
  const items = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(\`/v2/admin/\${kind}?\${params}\`);
    if (!response.ok) throw new Error(\`GET /v2/admin/\${kind}: \${response.status}\`);
    const result = await response.json();
    items.push(...result.items);
    cursor = result.next_cursor;
  } while (cursor);
  return items;
}
function latestGames(allData) {
  const latest = new Map();
  for (const game of allData.game_versions) latest.set(game.id, game);
  return [...latest.values()];
}
function userNames(allData) {
  return new Map(allData.users.map((user) => [user.id, user.display_name]));
}
`;

const SPEC={
  paths:{
    '/games':{get:{summary:'List games',parameters:[]}},
    '/things/{thing_id}':{post:{summary:'Make a thing',parameters:[{name:'thing_id',in:'path',required:true,schema:{type:'string'}}],
      requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{name:{type:'string'}},required:['name']}}}}}},
  },
  components:{schemas:{}},
};

function setup(respond) {
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,dataset:{},children:[],classList:{toggle(){}},
      append(){},replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(){},focus(){}});
    return nodes.get(id);
  };
  const storageData=new Map();
  const localStorage={getItem:k=>storageData.has(k)?storageData.get(k):null,
    setItem:(k,v)=>storageData.set(k,String(v)),removeItem:k=>storageData.delete(k)};
  const fetch=async(url)=>{
    if(url==='/openapi.json') return {ok:true,json:async()=>SPEC};
    const admin=/^\/v2\/admin\/(users|games|matches)\?/.exec(url);
    if(admin) return respond(admin[1]);
    throw new Error(`Unexpected fetch ${url}`);
  };
  const ctx=vm.createContext({console,Map,Set,URLSearchParams,
    document:{getElementById:node,createElement:()=>({}),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
    window:{addEventListener(){}},location:{hash:'',search:''},history:{replaceState(){}},
    localStorage,Node:class {},fetch,I18n:require('./i18n-stub.cjs'),
    el:(tag,attrs={},...children)=>({...attrs,tag,children}),toast:()=>{},showPageError:()=>{},reportClientError:()=>{}});
  vm.runInContext(COMMON_DEFS,ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../static/console.js'),'utf8'),ctx);
  const run=code=>vm.runInContext(code,ctx);
  return {node,run};
}

const settle=async()=>{ for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,5)); };
const operationButtons=(node)=>node('operations').children.filter(child=>child.class==='operation');

test('operations list renders even when the admin page requests fail',async()=>{
  const {node,run}=setup(()=>({ok:false,status:401,json:async()=>({})}));
  await settle();
  const buttons=operationButtons(node);
  assert.equal(buttons.length,2);
  assert.equal(run('state.selected.key'),'GET /games');
});

test('operations list renders when admin records lack optional fields',async()=>{
  // Agent-imported games may carry no updated_at, and stored matches
  // may lack players: neither may take the console page down.
  const parts={users:[{id:'u1',display_name:'Ann',password:'pw'}],
    games:[{id:'g1',name:'Game',version:1,deleted:false}],
    matches:[{id:'m1',game_id:'g1',status:'ongoing'}]};
  const {node,run}=setup((kind)=>({ok:true,status:200,json:async()=>({items:parts[kind],next_cursor:null})}));
  await settle();
  assert.equal(operationButtons(node).length,2);
  assert.equal(run('state.selected.key'),'GET /games');
  assert.equal(run('byRecentUpdate([{updated_at:"2026-01-02"},{},{updated_at:"2026-01-01"}]).map(x=>x.updated_at||"")').join(','),',2026-01-01,2026-01-02');
});
