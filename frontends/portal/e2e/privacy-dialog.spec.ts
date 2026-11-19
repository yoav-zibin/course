import {test,expect} from '@playwright/test';
import copy from '../src/platform/ui-copy.json';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Privacy dialog tests require a disposable loopback server.');
});

test('Privacy stays in a themed closable dialog and preserves the page underneath',async({page,context},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/portal');
  await page.getByRole('button',{name:'On this device',exact:true}).click();
  const before=page.url(),pages=context.pages().length;
  await page.getByRole('button',{name:'Privacy',exact:true}).click();
  const content=page.getByTestId('privacy-policy-content');
  await expect(content).toBeVisible();
  await expect(page.getByRole('heading',{name:'Privacy Policy for BuildPlay',exact:true})).toBeVisible();
  await expect(content).toContainText('Last updated: November 19, 2026.');
  await expect(content).toContainText('OpenAI Codex');
  await expect(content.getByRole('link',{name:'Google Analytics opt-out browser add-on'})).toBeAttached();
  await expect(content.getByRole('link',{name:'yoavgamingcoursezibin@gmail.com'})).toBeAttached();
  expect(context.pages().length).toBe(pages);expect(page.url()).toBe(before);
  const theme=await content.evaluate(node=>{for(let element:Element|null=node;element;element=element.parentElement){const color=getComputedStyle(element).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color;}return '';});
  expect(theme).toBe('rgb(23, 28, 42)');
  const bug=page.getByRole('button',{name:'Report a bug or request a feature',exact:true});
  await expect.poll(()=>bug.evaluate(node=>{const bounds=node.getBoundingClientRect();return node.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2));})).toBe(true);
  await page.screenshot({path:info.outputPath('privacy-modal.png')});
  await content.getByRole('link',{name:'yoavgamingcoursezibin@gmail.com'}).scrollIntoViewIfNeeded();
  await expect(content.getByRole('link',{name:'yoavgamingcoursezibin@gmail.com'})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(content).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'On this device',exact:true})).toBeVisible();
  expect(page.url()).toBe(before);expect(errors).toEqual([]);
});

test('the privacy dialog translates offline from the bundled policy copy',async({page,context})=>{
  await page.goto('/portal');
  await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await page.getByRole('button').filter({hasText:'Français'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('lang','fr');
  await page.getByRole('button',{name:copy['Close dialog'].fr,exact:true}).click();
  await context.setOffline(true);
  await page.getByRole('button',{name:copy.Privacy.fr,exact:true}).click();
  const content=page.getByTestId('privacy-policy-content');
  await expect(page.getByRole('heading',{name:(copy as Record<string,Record<string,string>>)['Privacy Policy for BuildPlay'].fr,exact:true})).toBeVisible();
  await expect(content).toContainText((copy as Record<string,Record<string,string>>)['How we use it'].fr);
  await page.getByRole('button',{name:copy['Close dialog'].fr,exact:true}).click();
  await expect(content).toHaveCount(0);
});
