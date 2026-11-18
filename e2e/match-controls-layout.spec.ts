import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {showMatchMenu} from './helpers';
declare const I18n:any;

// Native host component coverage. No account, real match or game-audit credit.
const portal=fs.readFileSync(path.join(__dirname,'../static/portal.html'),'utf8');

test('board-only navigation leaves Controls and tutorial reachable in every locale',async({page},testInfo)=>{
  test.setTimeout(180000);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/static/declarative-test.html');
  await page.evaluate(()=>document.head.querySelectorAll('style').forEach(node=>node.remove()));
  for(const url of ['/static/portal.css','/static/portal-match-layout.css'])await page.addStyleTag({url});
  await page.evaluate(html=>{
    const parsed=new DOMParser().parseFromString(html,'text/html');
    const match=document.importNode(parsed.getElementById('match')!,true) as HTMLElement;
    match.hidden=false;
    const shell=document.createElement('div');shell.className='app portal-shell';
    const main=document.createElement('main');main.className='work portal-main';main.append(match);shell.append(main);document.body.replaceChildren(shell);
    const sidebar=document.createElement('button');sidebar.type='button';sidebar.className='sidebar-toggle';sidebar.setAttribute('aria-label','Open sidebar');sidebar.textContent='☰';match.querySelector('.match-toolbar')!.prepend(sidebar);
    const clock=document.getElementById('match-clock')!;clock.hidden=false;clock.textContent='59:59';
    document.getElementById('how-to-play')!.hidden=false;
    document.getElementById('game-rules-text')!.textContent='Native host tutorial fixture.';
    const box=document.getElementById('game-box')!;box.hidden=false;box.classList.add('declarative-game');box.innerHTML='<svg class="declarative-stage" viewBox="0 0 300 300"><circle cx="150" cy="150" r="32" fill="#d2ff5a" /></svg>';
  },portal);
  await page.addScriptTag({url:'/static/portal-match-layout.js'});
  await page.evaluate(()=>{const w=window as any;w.PortalMatchLayout.init(()=>{});w.PortalMatchLayout.update({id:'component-fixture',status:'ongoing',boardOnly:true});});
  const toggle=page.locator('#match-controls-toggle'),tools=page.locator('#match-tools');
  for(const locale of ['en','es','fr','de','pt','zh','hi','ar']){
    await page.evaluate(async locale=>{await I18n.choose(locale);},locale);
    for(const viewport of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]){
      await page.setViewportSize(viewport);
        await expect(page.locator('#match-focus-toggle')).toBeHidden();
        await showMatchMenu(page);
        if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
        await toggle.click();await expect(tools).toBeVisible();
        const hit=await toggle.evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')?.id;});
        await testInfo.attach(`controls-${locale}-${viewport.width}`,{body:JSON.stringify({hit,toggle:await toggle.boundingBox(),tools:await tools.boundingBox()}),contentType:'application/json'});
        expect(hit).toBe('match-controls-toggle');
        if(['en','ar'].includes(locale)&&viewport.width===390)await testInfo.attach(`open-controls-${locale}`,{body:await page.screenshot(),contentType:'image/png'});
        await toggle.click();await expect(tools).toBeHidden();
        await toggle.click();
        const tutorial=page.locator('#how-to-play > summary');await tutorial.scrollIntoViewIfNeeded();
        const bounds=(await tutorial.boundingBox())!;expect(bounds.height).toBeGreaterThanOrEqual(32);expect(bounds.width).toBeGreaterThanOrEqual(32);
        await tutorial.click();await expect(page.locator('#how-to-play')).toHaveAttribute('open','');
        await tutorial.click();await expect(page.locator('#how-to-play')).not.toHaveAttribute('open','');
        await toggle.click();
        await page.keyboard.press('Escape');
        await expect(page.locator('.match-toolbar')).toBeHidden();
    }
  }
  await testInfo.attach('controls-final',{body:await page.screenshot(),contentType:'image/png'});
});
