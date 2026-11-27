import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {createUser,loginAs,uniqueName} from './helpers';

const packageFixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/core/bundled-tictactoe.json'),'utf8'));
const names=['Cobalt Alpha','Cobalt Bravo','Cobalt Charlie','Cobalt Delta','Cobalt Echo','Cobalt Foxtrot','Cobalt Golf','Cobalt Hotel','Chess'];
const games=names.map((name,index)=>({...packageFixture,id:`search-fixture-${index}`,name,description:'A disposable search fixture.',cover_url:null,
  alternative_names:name==='Cobalt Foxtrot'?['Arctic Fox']:[]}));

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Catalog checks require a disposable loopback server.');
});

async function catalog(page:Page,searchReply?:(prefix:string)=>Promise<void>){
  const queries:string[]=[],invalid:string[]=[],libraryWrites:string[]=[],opens:string[]=[];
  page.on('request',request=>{if(/\/saved-games\//.test(new URL(request.url()).pathname)&&request.method()!=='GET')libraryWrites.push(request.method());});
  await page.route('**/storage/capabilities',route=>route.fulfill({json:{pagination:true,search:'word-prefix'}}));
  await page.route('**/v2/games?*',async route=>{
    const url=new URL(route.request().url()),prefix=url.searchParams.get('q');
    if(prefix===null)return route.fulfill({json:{items:[games[0]],next_cursor:'not-displayed'}});
    queries.push(prefix);
    if(!/^[\p{L}\p{N}_]+$/u.test(prefix)||Array.from(prefix).length<2||Array.from(prefix).length>24){invalid.push(prefix);return route.fulfill({status:400,json:{detail:'search requires one word prefix of 2 to 24 characters'}});}
    if(searchReply)await searchReply(prefix);
    const items=games.filter(game=>[game.name,...game.alternative_names].some(name=>name.toLowerCase().split(/\W+/).some(word=>word.startsWith(prefix))));
    return route.fulfill({json:{items,next_cursor:null}});
  });
  await page.route('**/games/popular',route=>route.fulfill({json:[games[0],games[8]]}));
  await page.route('**/users/me/recent-games',route=>route.fulfill({json:[games[0]]}));
  await page.route('**/v2/users/me/saved-games?*',route=>route.fulfill({json:{items:[games[7]],next_cursor:null}}));
  await page.route('**/v2/matches?*',route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.route(url=>/^\/games\/search-fixture-\d+(?:\/versions\/1)?$/.test(url.pathname),route=>{
    const pathname=new URL(route.request().url()).pathname,id=pathname.split('/')[2];if(!pathname.includes('/versions/'))opens.push(id);return route.fulfill({json:games.find(game=>game.id===id)});
  });
  return {queries,invalid,libraryWrites,opens};
}

test('catalog keeps recent/popular discovery and offers bounded name suggestions without library or refresh controls',async({page,request},info)=>{
  await page.setViewportSize({width:info.project.name==='mobile'?390:1440,height:844});
  const user=await createUser(request,uniqueName('Catalog player'));await loginAs(page,user);
  const observed=await catalog(page);await page.goto('/portal#games');
  const search=page.getByRole('combobox',{name:'Search games',exact:true});await expect(search).toBeVisible();
  await expect(page.getByRole('heading',{name:'Recently played',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'POPULAR GAMES',exact:true})).toBeVisible();
  for(const name of ['All games','Saved games','Refresh','Load more games'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'All games',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^(?:Save|Unsave) /})).toHaveCount(0);
  await search.fill('c');await expect(page.getByRole('option',{name:'Cobalt Alpha',exact:true})).toBeVisible();
  await page.waitForTimeout(250);expect(observed.queries).toEqual([]);
  await search.fill('?!');await expect(page.getByRole('listbox')).toHaveCount(0);expect(observed.queries).toEqual([]);
  await search.fill('co');await expect.poll(()=>observed.queries.includes('co')).toBe(true);
  await expect(page.getByRole('option')).toHaveCount(6);
  await search.press('ArrowDown');
  const selected=page.getByRole('option').first();await expect(selected).toHaveAttribute('aria-selected','true');
  await expect(search).toHaveAttribute('aria-activedescendant',(await selected.getAttribute('id'))!);
  await search.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);
  await search.fill('x'.repeat(80));await expect.poll(()=>observed.queries.some(query=>query.length===24)).toBe(true);
  await expect(page.getByRole('option')).toHaveCount(0);
  await search.fill('Cobalt fo');await expect(page.getByRole('option',{name:'Cobalt Foxtrot',exact:true})).toBeVisible();
  await search.fill('arctic f');
  const alternate=page.getByRole('option',{name:'Cobalt Foxtrot (Arctic Fox)',exact:true});
  await expect(alternate).toHaveText('Cobalt Foxtrot (Arctic Fox)');
  await expect(page.getByRole('option')).toHaveCount(1);await search.press('ArrowDown');await search.press('Enter');
  await expect(page.getByRole('heading',{name:'Cobalt Foxtrot',exact:true})).toBeVisible();
  expect(observed.opens).toEqual(['search-fixture-5']);
  expect(observed.invalid).toEqual([]);expect(observed.libraryWrites).toEqual([]);
  await expect(page.getByText('search requires one word prefix of 2 to 24 characters',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('late suggestions cannot replace newer typing and a real suggestion tap opens the chosen game',async({page},info)=>{
  await page.setViewportSize({width:info.project.name==='mobile'?390:1440,height:844});
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  const observed=await catalog(page,async prefix=>{if(prefix==='co'){entered();await gate;}});
  try{
    await page.goto('/portal#games');const search=page.getByRole('combobox',{name:'Search games',exact:true});
    await search.fill('co');await started;
    const latest=page.waitForResponse(response=>new URL(response.url()).pathname==='/v2/games'&&new URL(response.url()).searchParams.get('q')==='chess');
    await search.fill('chess');await (await latest).finished();await expect(page.getByRole('option',{name:'Chess',exact:true})).toBeVisible();
    await expect.poll(()=>observed.queries.includes('chess')).toBe(true);
    release();await page.waitForTimeout(150);
    await expect(page.getByRole('option')).toHaveCount(1);await expect(page.getByRole('option',{name:'Cobalt Alpha',exact:true})).toHaveCount(0);
    if(info.project.name==='mobile')await page.getByRole('option',{name:'Chess',exact:true}).tap();
    else await page.getByRole('option',{name:'Chess',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Chess',exact:true})).toBeVisible();
    expect(observed.invalid).toEqual([]);
  }finally{release();}
});

test('both game carousels load additional pages at the horizontal edge',async({page,request})=>{
  const user=await createUser(request,uniqueName('Carousel player'));await loginAs(page,user);
  await catalog(page);
  await page.route('**/storage/capabilities',route=>route.fulfill({json:{pagination:true,game_carousels:true}}));
  const requests={recentGames:[] as string[],popularGames:[] as string[]};
  for(const [kind,path] of [['recentGames','/v2/users/me/recent-games'],['popularGames','/v2/games/popular']] as const){
    await page.route(url=>url.pathname===path,route=>{
      const cursor=new URL(route.request().url()).searchParams.get('cursor')||'first';
      requests[kind].push(cursor);
      const items=(cursor==='first'?games.slice(0,8):cursor==='empty'?[]:games.slice(8))
        .map(game=>({...game,name:`${kind} ${game.name}`}));
      return route.fulfill({json:{items,next_cursor:cursor==='first'?'empty':cursor==='empty'?'last':null}});
    });
  }
  await page.goto('/portal#games');
  for(const kind of ['recentGames','popularGames'] as const){
    const row=page.getByTestId(kind);
    await expect(row.getByRole('link',{name:`Play ${kind} Cobalt Alpha`,exact:true})).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    const requestedPages=()=>requests[kind].filter(cursor=>cursor!=='first');
    expect(requestedPages()).toEqual([]);
    await expect(async()=>{
      await row.evaluate(async element=>{
        element.scrollLeft=0;
        await new Promise(requestAnimationFrame);
        element.scrollLeft=element.scrollWidth;
      });
      await expect.poll(requestedPages,{timeout:1000}).toEqual(['empty','last']);
    }).toPass({timeout:10000});
    await row.evaluate(element=>{element.scrollLeft=element.scrollWidth;});
    await expect(row.getByRole('link',{name:`Play ${kind} Chess`,exact:true})).toBeVisible();
  }
});
