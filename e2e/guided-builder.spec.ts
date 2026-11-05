import {test,expect} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';
test('guided builder saves a draft, restores it, and never approves an empty step',async({page,request})=>{
 const user=await createUser(request,uniqueName('Designer'));await loginAs(page,user);
 await page.goto('/static/guided-builder.html');
 await page.getByRole('button',{name:'+ New game',exact:true}).click();
 await expect(page.locator('#workspace')).toBeVisible();
 await expect(page.locator('#steps button')).toHaveCount(7);
 await expect(page.locator('#approve')).toBeDisabled();
 const url=page.url();await page.reload();
 await expect(page.locator('#workspace')).toBeVisible();expect(page.url()).toBe(url);
 await page.locator('#steps button').nth(3).click();
 await expect(page.locator('#propose')).toBeDisabled();
 await page.locator('#steps button').first().click();
 await page.locator('#correction').fill('Count to three, a one-player game.');
 // Exercise a provider outage without invoking any paid generation.
 await page.route('**/workflow/propose',route=>route.fulfill({status:503,json:{detail:'Model unavailable for this test'}}));
 await page.locator('#propose').click();
 await expect(page.locator('#page-error')).toContainText('Model unavailable');
 await expect(page.locator('#approve')).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('tutorial preview is sandboxed and supports explicit viewport widths',async({page,request})=>{
 const user=await createUser(request,uniqueName('Tutorial'));await loginAs(page,user);
 await page.goto('/static/guided-builder.html');
 await page.getByRole('button',{name:'+ New game',exact:true}).click();
 await expect(page.locator('#workspace')).toBeVisible();
 const id=new URL(page.url()).hash.slice(1);
 // Seed a proposed tutorial in the read response; no model call or paid generation.
 await page.route('**/game-drafts/'+id,async route=>{
  const response=await route.fetch();const draft=await response.json();
  draft.builder_workflow.artifacts.tutorial={status:'draft',revision:1,value:{text:'Learn to count',html:'<meta name="viewport" content="width=device-width"><h1>Count to three</h1><button onclick="this.textContent=\'Started\'">Try it</button>'}};
  await route.fulfill({response,json:draft});
 });
 await page.reload();await page.locator('#steps button').nth(4).click();
 const frame=page.locator('iframe[title="Game tutorial"]');
 await expect(frame).toHaveAttribute('sandbox','allow-scripts');
 await page.frameLocator('iframe[title="Game tutorial"]').getByRole('button',{name:'Try it'}).click();
 await expect(page.frameLocator('iframe[title="Game tutorial"]').getByRole('button',{name:'Started'})).toBeVisible();
 await page.getByRole('button',{name:'820 px',exact:true}).click();
 expect(await frame.evaluate(e=>e.getBoundingClientRect().width)).toBe(820);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('#approve')).toBeDisabled();
});

test('approved cards, changed artifact comparison and emulator feedback stay reviewable',async({page,request})=>{
 const user=await createUser(request,uniqueName('Review'));await loginAs(page,user);
 await page.goto('/static/guided-builder.html');await page.locator('#new-draft').click();
 await expect(page.locator('#workspace')).toBeVisible();const id=new URL(page.url()).hash.slice(1);
 let current:any;
 await page.route('**/game-drafts/'+id,async route=>{
  const response=await route.fetch();current=await response.json();
  const f=current.builder_workflow;
  for(const step of ['understanding','identity','logic','ui','tutorial','images','tests'])f.artifacts[step]={status:'approved',revision:1,value:{text:'Original rules'}};
  f.conversation=[{role:'user',step:'logic',text:'Approved',artifact_revision:1}];
  f.job={status:'ready_for_review',stage:'Play the game',log:[]};
  await route.fulfill({response,json:current});
 });
 await page.reload();await page.locator('.history summary').first().click();await page.getByText('Game rules · approved version 1',{exact:true}).click();
 await expect(page.locator('#conversation')).toContainText('Original rules');
 await page.route('**/workflow/feedback',async route=>{
  expect(route.request().postDataJSON().text).toBe('The winning total is wrong');
  const f=current.builder_workflow;
  f.history.push({step:'logic',status:'approved',revision:1,approved_digest:'old',value:{text:'Original rules'}});
  f.artifacts.logic={status:'draft',revision:2,value:{text:'Win at exactly six'}};
  f.review_step='logic';f.job=null;current.revision++;
  await route.fulfill({json:current});
 });
 await page.locator('#emulator-feedback').fill('The winning total is wrong');await page.locator('#feedback').click();
 await expect(page.locator('#artifact-title')).toHaveText('Game rules');
 await expect(page.locator('#artifact-changes')).toContainText('Before — approved');
 await expect(page.locator('#artifact-changes')).toContainText('Original rules');
 await expect(page.locator('#artifact-changes')).toContainText('Win at exactly six');
 await expect(page.locator('#approve')).toBeEnabled();
 await expect(page.locator('#publish')).not.toBeVisible();
});

test('tutorial translates interactive feedback and preserves progress in RTL',async({page})=>{
 await page.goto('/static/guided-builder.html');
 await page.addScriptTag({url:'/static/tutorial-frame.js?v=1'});
 const fs=await import('node:fs');
 const helper=fs.readFileSync('game_i18n_helper.js','utf8');
 const html=`<meta name="viewport" content="width=device-width"><script type="application/json" id="i18n-strings">{"add":"Add one","total":"Total: {count}"}</script><button id="add"></button><p id="total"></p><script>${helper}
 let n=0;function render(){add.textContent=t('add');total.textContent=t('total',{count:n});}
 add.onclick=()=>{n++;render();};window.addEventListener('message',e=>{if(e.source===parent&&e.data.type==='tutorial_locale'){applyLocale(e.data);render();}});render();</script>`;
 await page.evaluate(({html})=>{
  const frame=document.createElement('iframe');frame.id='test-tutorial';frame.sandbox.add('allow-scripts');
  frame.srcdoc=(window as any).TutorialFrame.documentSource(html,{'Add one':'أضف واحدا','Total: {count}':'المجموع: {count}'},'ar','rtl');document.body.append(frame);
 },{html});
 const tutorial=page.frameLocator('#test-tutorial');
 await expect(tutorial.getByRole('button')).toHaveText('أضف واحدا');
 await tutorial.getByRole('button').click();await expect(tutorial.locator('#total')).toHaveText('المجموع: 1');
 await expect(tutorial.locator('html')).toHaveAttribute('dir','rtl');
 await page.locator('#test-tutorial').evaluate((frame:any)=>frame.contentWindow.postMessage({type:'tutorial_locale',locale:'en',direction:'ltr'},'*'));
 await expect(tutorial.locator('#total')).toHaveText('Total: 1');
 await expect(tutorial.locator('html')).toHaveAttribute('dir','ltr');
});

test('guided steps explain outstanding questions and follow skin previews',async({page,request})=>{
 const user=await createUser(request,uniqueName('Guide'));await loginAs(page,user);
 await page.goto('/new-builder?skin=sunset');await page.locator('#new-draft').click();
 await expect(page.locator('#workspace')).toBeVisible();
 const id=new URL(page.url()).hash.slice(1);
 await page.route('**/game-drafts/'+id,async route=>{
   const response=await route.fetch(), d=await response.json();
   d.builder_workflow.artifacts.understanding={status:'draft',value:{text:'Add numbers to six.',questions:['Who goes first?']}};
   await route.fulfill({response,json:d});
 });
 for(const skin of ['sunset','aurora','immersive','classic']){
   await page.goto('/new-builder?skin='+skin+'#'+id);await page.reload();
   await expect(page.locator('#questions')).toContainText('Who goes first?');
   await expect(page.locator('#next-action')).toContainText('Submit your answers');
   await expect(page.locator('#approve')).toBeDisabled();
   await expect(page.getByRole('button',{name:'Submit answers'})).toBeVisible();
   if(skin!=='classic')await expect(page.locator('html')).toHaveAttribute('data-skin',skin);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
