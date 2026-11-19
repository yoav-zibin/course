import {test,expect} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';
import copy from '../src/platform/ui-copy.json';

test('account menu opens the public deletion-request page without sharing credentials',async({page,request,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Deletion checks require a disposable loopback server.');
  const user=await createUser(request,uniqueName('Deletion request'));
  await loginAs(page,user);await page.goto('/portal');
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  const action=page.getByRole('button',{name:'Request account deletion',exact:true});
  await expect(action).toBeVisible();
  const popup=page.waitForEvent('popup');
  await action.click();
  const info=await popup;
  await expect(info).toHaveURL(new URL('/delete-account',baseURL).href);
  await expect(info.getByRole('heading',{name:'Delete your BuildPlay account',exact:true})).toBeVisible();
  await expect(info.getByRole('link',{name:'yoavgamingcoursezibin@gmail.com'}).first()).toHaveAttribute('href',/^mailto:yoavgamingcoursezibin@gmail\.com/);
  await info.close();
  await page.getByRole('button').filter({hasText:'العربية'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  const translatedPopup=page.waitForEvent('popup');
  await page.getByRole('button',{name:copy['Request account deletion'].ar,exact:true}).click();
  const translatedInfo=await translatedPopup;await expect(translatedInfo).toHaveURL(new URL('/delete-account',baseURL).href);
  await translatedInfo.close();
  await page.getByRole('button').filter({hasText:'English'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  // This opens instructions only. It never deletes or signs out the active user.
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toContainText(user.display_name);
});
