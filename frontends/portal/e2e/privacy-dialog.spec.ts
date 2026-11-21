import {test,expect} from '@playwright/test';
import copy from '../src/platform/ui-copy.json';
import policy from '../src/platform/privacy-policy.json';
import {createUser,loginAs,uniqueName} from './helpers';
const retention=policy.blocks.find(block=>block.text.startsWith('Your account data is kept'))!.text;
const updated=policy.blocks.find(block=>block.text.startsWith('Last updated:'))!.text;

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Privacy dialog tests require a disposable loopback server.');
});

test('Privacy opens from the bottom of the profile and preserves the profile draft and page underneath',async({page,context,request},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await loginAs(page,await createUser(request,uniqueName('Privacy player')));
  await page.goto('/portal#local');
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Preferences',exact:true})).toHaveCount(0);
  const before=page.url(),pages=context.pages().length;
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  await page.getByRole('textbox',{name:'Display name',exact:true}).fill('Unsubmitted privacy profile draft');
  await page.getByRole('button',{name:'Privacy',exact:true}).click();
  const content=page.getByTestId('privacy-policy-content');
  await expect(content).toBeVisible();
  await expect(page.getByRole('heading',{name:'Privacy Policy for BuildPlay',exact:true})).toBeVisible();
  await expect(content).toContainText(updated);
  await expect(content).toContainText('Unexpected client errors automatically send recent diagnostics and your account identity when available, without a screenshot, dialog or action from you.');
  await expect(content).toContainText('Automatic reports have rate limits and duplicate suppression.');
  await expect(content).toContainText('OpenAI Codex');
  await expect(content).toContainText('are removed when account deletion completes.');
  await expect(content).toContainText('You can undo the request for 24 hours');
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
  await page.getByRole('button',{name:'Close dialog',exact:true}).last().click();
  await expect(content).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Display name',exact:true})).toHaveValue('Unsubmitted privacy profile draft');
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Single-player matches',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toHaveCount(0);
  expect(page.url()).toBe(before);expect(errors).toEqual([]);
});

test('anonymous visitors can read Privacy offline from the translated account dialog',async({page,context})=>{
  await page.goto('/portal');
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await page.getByRole('button').filter({hasText:'Français'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('lang','fr');
  await context.setOffline(true);
  await page.getByRole('button',{name:copy.Privacy.fr,exact:true}).click();
  const content=page.getByTestId('privacy-policy-content');
  await expect(page.getByRole('heading',{name:(copy as Record<string,Record<string,string>>)['Privacy Policy for BuildPlay'].fr,exact:true})).toBeVisible();
  await expect(content).toContainText((copy as Record<string,Record<string,string>>)['How we use it'].fr);
  await expect(content).toContainText((copy as Record<string,Record<string,string>>)[retention].fr);
  await page.getByRole('button',{name:copy['Close dialog'].fr,exact:true}).last().click();
  await expect(content).toHaveCount(0);
  await expect(page.getByRole('button',{name:copy.Privacy.fr,exact:true})).toBeVisible();
  await page.getByRole('button',{name:copy['Close dialog'].fr,exact:true}).click();
  await expect(page.getByRole('button',{name:copy.Privacy.fr,exact:true})).toHaveCount(0);
});
